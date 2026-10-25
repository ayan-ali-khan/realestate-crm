# Diagrams — data model and key flows

Mermaid renders these inline on GitHub and in most editors.

## Entity-relationship diagram

Mirrors `apps/api/prisma/schema.prisma` (Phase 1; rationale in
[ADR-004](DECISIONS.md) and [ADR-006](DECISIONS.md)). Only key columns shown.

```mermaid
erDiagram
    User ||--o{ Lead : "assignedLeads (LeadAssignedTo)"
    User ||--o{ Activity : "logs"
    User ||--o{ Task : "assignedTasks (TaskAssignee)"
    User ||--o{ RefreshToken : "holds"
    Lead ||--o{ Activity : "has (timeline)"
    Lead ||--o{ Task : "has"
    Lead ||--o{ LeadProperty : "inquires about"
    Lead ||--o{ SiteVisit : "attends"
    Property ||--o{ LeadProperty : "receives inquiries from"
    Property ||--o{ SiteVisit : "is visited for"

    User {
        string id PK
        string name
        string email UK
        string passwordHash
        enum role "ADMIN | MANAGER | AGENT"
    }
    Lead {
        string id PK
        string name
        string email "nullable (walk-ins may leave only a phone)"
        string phone "nullable"
        enum source "WEBSITE | REFERRAL | ZILLOW | WALK_IN | COLD_CALL | SOCIAL_MEDIA | OTHER"
        int budgetMin "nullable"
        int budgetMax "nullable"
        string preferredLocation
        enum stage "NEW_LEAD → … → CLOSED_WON / CLOSED_LOST"
        enum priority "LOW | MEDIUM | HIGH | URGENT"
        int aiScore "0-100, AI service only"
        string aiScoreReason
        string assignedToId FK "nullable (unassigned)"
        bool convertedToCustomer "lead doubles as customer (ADR-004)"
        datetime convertedAt
        datetime deletedAt "soft delete — history stays referentially intact"
    }
    Property {
        string id PK
        string title
        int price
        string city
        enum type "APARTMENT | HOUSE | VILLA | TOWNHOUSE | LAND | COMMERCIAL"
        enum status "AVAILABLE | RESERVED | SOLD"
    }
    LeadProperty {
        string leadId PK "composite (leadId, propertyId)"
        string propertyId PK "composite"
        string note "nullable interest note"
    }
    Activity {
        string id PK
        string leadId FK
        string userId FK "nullable (deleted user / AI actions)"
        enum type "CALL | EMAIL | NOTE | STAGE_CHANGE | SITE_VISIT | AI_ACTION"
        string content
        json metadata "from/to, visitId, AI model + payload…"
    }
    Task {
        string id PK
        string leadId FK
        string assigneeId FK
        string title
        datetime dueAt
        enum status "PENDING | DONE | CANCELLED"
        bool isOverdue "writes + nightly sweep keep it honest"
        enum createdBy "USER | AI"
    }
    RefreshToken {
        string id PK
        string tokenHash UK "SHA-256 of the token — never the raw value"
        string userId FK
        datetime expiresAt "pruned nightly after expiry"
        datetime revokedAt "rotation + replay detection (ADR-007)"
    }
    SiteVisit {
        string id PK
        string leadId FK
        string propertyId FK
        datetime scheduledAt
        enum status "SCHEDULED | COMPLETED | CANCELLED | NO_SHOW"
    }
```

## Authentication flow (httpOnly cookies + rotating refresh)

```mermaid
sequenceDiagram
    participant B as Browser (web app)
    participant A as API (Express)
    participant D as Database

    B->>A: POST /auth/login {email, password}
    A->>D: verify bcrypt hash
    A-->>B: Set-Cookie: crm_access (15m, httpOnly) + crm_refresh (7d, Path=/api/v1/auth)
    Note over B: JS never sees either token (ADR-007)

    B->>A: GET /leads (cookie attached automatically)
    A->>D: verify JWT, scope query by role
    A-->>B: { success, data, error } envelope

    Note over B,A: access cookie expired → 401
    B->>A: POST /auth/refresh (refresh cookie rides along)
    A->>D: store new token hash, revoke the presented one
    A-->>B: Set-Cookie: rotated pair
    B->>A: replay the original request with the fresh cookie
    Note over A,D: replaying an already-rotated token = 401 + chain revocation
```

## Pipeline stage machine (ADR-009)

The API owns this table; `GET /leads/:id` returns the legal next moves as
`allowedTransitions` so the UI renders exactly the valid buttons and never
re-implements the rules.

```mermaid
stateDiagram-v2
    [*] --> NEW_LEAD : lead created
    NEW_LEAD --> CONTACTED
    NEW_LEAD --> CLOSED_LOST
    CONTACTED --> NEW_LEAD
    CONTACTED --> SITE_VISIT
    CONTACTED --> CLOSED_LOST
    SITE_VISIT --> CONTACTED
    SITE_VISIT --> NEGOTIATION
    SITE_VISIT --> CLOSED_LOST
    NEGOTIATION --> SITE_VISIT
    NEGOTIATION --> CLOSED_WON : converts lead (customer flag + timestamp)
    NEGOTIATION --> CLOSED_LOST
    CLOSED_WON --> [*] : terminal — a won deal does not un-happen
    CLOSED_LOST --> NEW_LEAD : re-engaged lead restarts fresh
```

Forward moves may skip stages; same-stage moves and illegal jumps answer 409
with the allowed targets in the error message.

## AI request flow (ADR-011)

```mermaid
sequenceDiagram
    participant U as Lead detail (AI assist)
    participant A as API (ai.service)
    participant P as Provider (any OpenAI-compatible endpoint)
    participant D as Database

    U->>A: POST /leads/:id/ai/score {note?}
    A->>A: findAccessibleLead (out-of-scope id → 404, before any AI check)
    A->>P: POST {AI_BASE_URL}/chat/completions (strict json_schema)
    P-->>A: JSON answer
    A->>A: zod-validate (invalid → 502, never a wrong score)
    A->>D: persist aiScore/aiReason + AI_ACTION activity
    A-->>U: { success: { score, reason, model, scoredAt } }
    Note over U: no AI_API_KEY configured → 503 with a "set AI_API_KEY" message;<br/>timeout → 504; every answer (success or failure) is auditable
```

## Request lifecycle (web → API)

```mermaid
flowchart LR
    R[Request] --> P{proxy.ts:<br/>crm_access cookie present?}
    P -- no --> L[/login]
    P -- yes --> S[Shell + page<br/>typed api client]
    S -->|fetch credentials: include| M{Express middleware}
    M --> G[rate limit → auth → validate]
    G --> C[controller → service]
    C --> DB[(Postgres via Prisma)]
    C --> E["{ success, data, error } envelope"]
    E --> S
    style L fill:#fee
    style E fill:#eef
```

Every layer validates: zod at the route boundary, the service re-checks
authorization (`findAccessibleLead`, `requireRole`), and the error handler is
the single place that turns failures into the envelope.

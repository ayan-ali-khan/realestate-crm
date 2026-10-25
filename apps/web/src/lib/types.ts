// DTOs mirroring the API's response envelope (apps/api/src/http/response.ts).
// The API is the single source of truth; these types are its echo — when the
// API changes, change these first and the compiler finds every caller.

export interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

// --- enums (mirror apps/api/prisma/schema.prisma) ---

export const PIPELINE_STAGES = [
  'NEW_LEAD',
  'CONTACTED',
  'SITE_VISIT',
  'NEGOTIATION',
  'CLOSED_WON',
  'CLOSED_LOST',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const LEAD_SOURCES = [
  'WEBSITE',
  'REFERRAL',
  'ZILLOW',
  'WALK_IN',
  'COLD_CALL',
  'SOCIAL_MEDIA',
  'OTHER',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'NOTE'] as const; // client-loggable subset
export type ActivityType =
  (typeof ACTIVITY_TYPES)[number] | 'STAGE_CHANGE' | 'SITE_VISIT' | 'AI_ACTION';

export const TASK_STATUSES = ['PENDING', 'DONE', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PROPERTY_TYPES = [
  'APARTMENT',
  'HOUSE',
  'VILLA',
  'TOWNHOUSE',
  'LAND',
  'COMMERCIAL',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_STATUSES = ['AVAILABLE', 'RESERVED', 'SOLD'] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export type Role = 'AGENT' | 'MANAGER' | 'ADMIN';

// --- entities ---

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt?: string;
  updatedAt?: string;
}

export interface Property {
  id: string;
  title: string;
  // Full-row responses only — the list endpoint omits payload-heavy fields
  // (matches PROPERTY_CARD_SELECT in the API).
  description?: string;
  price: number;
  location: string;
  city: string;
  type: PropertyType;
  bedrooms: number;
  bathrooms: number;
  areaSqft: number;
  amenities?: string[];
  // Delivery URLs (seed links or Cloudinary) — returned by list + full row.
  images: string[];
  status: 'AVAILABLE' | 'RESERVED' | 'SOLD';
}

export interface CreatePropertyBody {
  title: string;
  description: string;
  price: number;
  location: string;
  city: string;
  type: PropertyType;
  bedrooms?: number;
  bathrooms?: number;
  areaSqft: number;
  amenities?: string[];
}

export interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  budgetMin: number | null;
  budgetMax: number | null;
  preferredLocation: string | null;
  stage: PipelineStage;
  priority: LeadPriority;
  // Populated only by the AI service (POST /leads/:id/ai/score); null until
  // someone asks for a score.
  aiScore: number | null;
  aiScoreReason: string | null;
  convertedToCustomer: boolean;
  convertedAt: string | null;
  assignedTo: User | null;
  createdAt: string;
  updatedAt: string;
  _count?: { inquiries: number; siteVisits: number; activities: number };
}

export interface Inquiry {
  // LeadProperty has a composite PK — there is no `id` scalar on the wire.
  leadId: string;
  propertyId: string;
  note: string | null;
  createdAt: string;
  property: Pick<Property, 'id' | 'title' | 'price' | 'location' | 'city' | 'type' | 'status'>;
}

export interface SiteVisit {
  id: string;
  scheduledAt: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  property: Pick<Property, 'id' | 'title' | 'location' | 'city'>;
}

export interface LeadDetail extends Lead {
  inquiries: Inquiry[];
  siteVisits: SiteVisit[];
  // Legal next moves for the current stage (POST /leads/:id/stage validates
  // again — this is for rendering buttons, never a security boundary).
  allowedTransitions: PipelineStage[];
}

export interface Activity {
  id: string;
  type: ActivityType;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  user: User;
}

export interface Task {
  id: string;
  title: string;
  dueAt: string;
  status: TaskStatus;
  isOverdue: boolean;
  assignee: User;
  lead: Pick<Lead, 'id' | 'name' | 'stage' | 'priority'>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeadBody {
  name: string;
  email?: string;
  phone?: string;
  source: LeadSource;
  budgetMin?: number;
  budgetMax?: number;
  preferredLocation?: string;
  priority?: LeadPriority;
  assignedToId?: string;
}

export interface LeadFilters {
  q?: string;
  stage?: PipelineStage;
  source?: LeadSource;
  priority?: LeadPriority;
  converted?: boolean;
  page?: number;
  pageSize?: number;
}

export interface TaskFilters {
  status?: TaskStatus;
  overdue?: boolean;
  leadId?: string;
  page?: number;
  pageSize?: number;
}

// --- AI features (Phase 6): mirrors of the ai.service wire shapes ---

export interface AiScoreResult {
  score: number;
  reason: string;
  model: string;
  scoredAt: string;
}

export interface AiEmailDraft {
  subject: string;
  body: string;
  model: string;
}

export interface AiSummary {
  summary: string;
  model: string;
}

export interface AiTaskSuggestion {
  title: string;
  dueInDays: number;
  reason: string;
}

export interface AiTaskSuggestions {
  suggestions: AiTaskSuggestion[];
  model: string;
}

// AI features (Phase 6): lead scoring, follow-up drafting, interaction
// summaries and task suggestions — every one a real model call through
// ai.provider (no heuristics pretending to be AI; MOCKED.md stays empty).
//
// Access rules mirror the lead itself: findAccessibleLead FIRST, so another
// agent's lead answers 404 before any AI configuration check — AI endpoints
// must not leak which lead ids exist. Every feature writes an AI_ACTION
// activity so the timeline shows exactly what the AI did, when, and with
// which model (userId = the human who asked, not null).
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import type { TokenPayload } from '../../lib/tokens.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { findAccessibleLead } from '../leads/leads.service.js';
import { chatJson } from './ai.provider.js';

// ---------------------------------------------------------------- validation

const scoreSchema = z.object({
  // Clamped, not rejected: a model that answers 101 still produces a usable
  // 100; the schema only rejects non-numeric nonsense.
  score: z.number().transform((v) => Math.max(0, Math.min(100, Math.round(v)))),
  reason: z.string().trim().min(1).max(500),
});

const emailSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
});

const summarySchema = z.object({
  summary: z.string().trim().min(1).max(2000),
});

const suggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        dueInDays: z.number().transform((v) => Math.max(1, Math.min(30, Math.round(v)))),
        reason: z.string().trim().min(1).max(300),
      }),
    )
    .max(5),
});

// Strict-subset JSON Schemas for response_format (all required,
// additionalProperties:false) — mirrors of the zod gates above.
const scoreJsonSchema = {
  type: 'object',
  properties: {
    score: { type: 'integer', description: '0-100 lead quality/buying-intent score' },
    reason: { type: 'string', description: 'One short sentence explaining the score' },
  },
  required: ['score', 'reason'],
  additionalProperties: false,
} as const;

const emailJsonSchema = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
  },
  required: ['subject', 'body'],
  additionalProperties: false,
} as const;

const summaryJsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One concise paragraph, max 120 words' },
  },
  required: ['summary'],
  additionalProperties: false,
} as const;

const suggestionsJsonSchema = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          dueInDays: { type: 'integer', description: '1-30 days from today' },
          reason: { type: 'string' },
        },
        required: ['title', 'dueInDays', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
} as const;

// ------------------------------------------------------------------- dossier

// Compact, honest context: everything the model gets is real CRM data, newest
// interactions first, bounded so a busy lead cannot blow the context window.
async function buildDossier(leadId: string): Promise<string> {
  const [lead, activities, tasks, inquiries, visits] = await Promise.all([
    prisma.lead.findFirstOrThrow({
      where: { id: leadId },
      include: { assignedTo: { select: { name: true } } },
    }),
    prisma.activity.findMany({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { type: true, content: true, createdAt: true },
    }),
    prisma.task.findMany({
      where: { leadId },
      orderBy: { dueAt: 'asc' },
      take: 10,
      select: { title: true, status: true, dueAt: true, isOverdue: true },
    }),
    prisma.leadProperty.findMany({
      where: { leadId },
      take: 5,
      include: { property: { select: { title: true, city: true, price: true, status: true } } },
    }),
    prisma.siteVisit.findMany({
      where: { leadId },
      orderBy: { scheduledAt: 'desc' },
      take: 5,
      include: { property: { select: { title: true, city: true } } },
    }),
  ]);

  const daysOld = Math.max(
    0,
    Math.floor((Date.now() - lead.createdAt.getTime()) / 86_400_000),
  );
  const date = (d: Date): string => d.toISOString().slice(0, 10);

  return [
    `Name: ${lead.name}`,
    `Contact: email=${lead.email ?? 'none'}, phone=${lead.phone ?? 'none'}`,
    `Source: ${lead.source}; priority: ${lead.priority}`,
    `Stage: ${lead.stage}${lead.convertedToCustomer ? ' (converted customer)' : ''}`,
    `Budget: ${lead.budgetMin ?? 'unstated'} – ${lead.budgetMax ?? 'unstated'} USD`,
    `Preferred location: ${lead.preferredLocation ?? 'not stated'}`,
    `Assigned agent: ${lead.assignedTo?.name ?? 'unassigned'}`,
    `Created: ${date(lead.createdAt)} (${daysOld} days ago)`,
    `Existing AI score: ${lead.aiScore ?? 'none'}${
      lead.aiScoreReason ? ` — ${lead.aiScoreReason}` : ''
    }`,
    '',
    'Interested properties:',
    inquiries.length
      ? inquiries
          .map(
            (i) =>
              `- ${i.property.title} (${i.property.city}, ${i.property.price} USD, ${i.property.status})`,
          )
          .join('\n')
      : '(none)',
    'Site visits:',
    visits.length
      ? visits
          .map((v) => `- ${date(v.scheduledAt)} ${v.property.title} (${v.status})`)
          .join('\n')
      : '(none)',
    'Tasks:',
    tasks.length
      ? tasks
          .map(
            (t) =>
              `- ${t.title} (due ${date(t.dueAt)}, ${t.status}${t.isOverdue ? ', OVERDUE' : ''})`,
          )
          .join('\n')
      : '(none)',
    'Recent interactions (newest first):',
    activities.length
      ? activities.map((a) => `- ${date(a.createdAt)} [${a.type}] ${a.content}`).join('\n')
      : '(none)',
  ].join('\n');
}

const SYSTEM_BASE =
  'You are an assistant inside a real-estate CRM. Use ONLY the dossier you are given; ' +
  'never invent properties, prices, people or dates. If the dossier is thin, say so in your ' +
  'reasoning and score conservatively.';

const withNote = (dossier: string, note: string | undefined): string =>
  note ? `${dossier}\n\nAgent's hint for this request: ${note}` : dossier;

async function recordAiAction(
  leadId: string,
  userId: string,
  content: string,
  metadata: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.activity.create({
    data: { leadId, userId, type: 'AI_ACTION', content, metadata },
  });
}

// ------------------------------------------------------------------- features

export interface ScoreResult {
  score: number;
  reason: string;
  model: string;
  scoredAt: string;
}

export async function scoreLead(
  leadId: string,
  note: string | undefined,
  auth: TokenPayload,
): Promise<ScoreResult> {
  await findAccessibleLead(leadId, auth);
  const dossier = await buildDossier(leadId);

  const { value, model } = await chatJson({
    name: 'lead_score',
    temperature: 0.2,
    system: `${SYSTEM_BASE} Score the lead's buying intent and quality from 0 to 100: budget clarity, contact completeness, source, engagement history (calls, emails, visits), recency and pipeline progress. Respond with JSON.`,
    user: withNote(dossier, note),
    jsonSchema: scoreJsonSchema,
    parse: scoreSchema,
  });

  const scoredAt = new Date();
  // Score + timeline entry in one transaction: the header chip and the
  // activity feed can never disagree.
  await prisma.$transaction([
    prisma.lead.update({
      where: { id: leadId },
      data: { aiScore: value.score, aiScoreReason: value.reason },
    }),
    prisma.activity.create({
      data: {
        leadId,
        userId: auth.sub,
        type: 'AI_ACTION',
        content: `AI lead score ${value.score}/100 — ${value.reason}`,
        metadata: { kind: 'lead_score', score: value.score, reason: value.reason, model },
      },
    }),
  ]);

  return { score: value.score, reason: value.reason, model, scoredAt: scoredAt.toISOString() };
}

export interface EmailDraft {
  subject: string;
  body: string;
  model: string;
}

export async function draftFollowUpEmail(
  leadId: string,
  note: string | undefined,
  auth: TokenPayload,
): Promise<EmailDraft> {
  await findAccessibleLead(leadId, auth);
  const dossier = await buildDossier(leadId);

  const { value, model } = await chatJson({
    name: 'follow_up_email',
    temperature: 0.7,
    system: `${SYSTEM_BASE} Draft a follow-up email to the lead from their assigned agent: warm, professional, at most 150 words, one clear next step, no pressure. Reference real properties or visits only when the dossier has them. Respond with JSON.`,
    user: withNote(dossier, note),
    jsonSchema: emailJsonSchema,
    parse: emailSchema,
  });

  await recordAiAction(leadId, auth.sub, `AI drafted email: ${value.subject}`, {
    kind: 'follow_up_email',
    subject: value.subject,
    body: value.body,
    model,
  });
  return { ...value, model };
}

export interface InteractionSummary {
  summary: string;
  model: string;
}

export async function summarizeInteractions(
  leadId: string,
  note: string | undefined,
  auth: TokenPayload,
): Promise<InteractionSummary> {
  await findAccessibleLead(leadId, auth);
  const dossier = await buildDossier(leadId);

  const { value, model } = await chatJson({
    name: 'interaction_summary',
    temperature: 0.3,
    system: `${SYSTEM_BASE} Summarize this lead's history in one concise paragraph (max 120 words): who they are, what they want, what has happened, and the single best next step. Respond with JSON.`,
    user: withNote(dossier, note),
    jsonSchema: summaryJsonSchema,
    parse: summarySchema,
  });

  await recordAiAction(leadId, auth.sub, `AI interaction summary: ${value.summary}`, {
    kind: 'interaction_summary',
    summary: value.summary,
    model,
  });
  return { summary: value.summary, model };
}

export interface TaskSuggestion {
  title: string;
  dueInDays: number;
  reason: string;
}

export interface TaskSuggestionsResult {
  suggestions: TaskSuggestion[];
  model: string;
}

// Suggestions only — creating a task stays a human decision through the
// regular POST /tasks endpoint (the UI offers one-click accept).
export async function suggestTasks(
  leadId: string,
  note: string | undefined,
  auth: TokenPayload,
): Promise<TaskSuggestionsResult> {
  await findAccessibleLead(leadId, auth);
  const dossier = await buildDossier(leadId);

  const { value, model } = await chatJson({
    name: 'task_suggestions',
    temperature: 0.4,
    system: `${SYSTEM_BASE} Suggest 2 to 4 concrete follow-up tasks for this lead, each with a due date 1-30 days out and a one-sentence reason grounded in the dossier. Respond with JSON.`,
    user: withNote(dossier, note),
    jsonSchema: suggestionsJsonSchema,
    parse: suggestionsSchema,
  });

  await recordAiAction(
    leadId,
    auth.sub,
    `AI suggested ${value.suggestions.length} task${value.suggestions.length === 1 ? '' : 's'}`,
    { kind: 'task_suggestions', suggestions: value.suggestions, model },
  );
  return { suggestions: value.suggestions, model };
}

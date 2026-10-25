// The AI layer's provider client (ADR-011): plain fetch against any
// OpenAI-compatible /chat/completions endpoint — OpenAI, Groq, OpenRouter,
// DeepSeek, Gemini's compat layer — so the provider is chosen by env config
// (AI_BASE_URL + AI_MODEL + AI_API_KEY), never by code. No SDK: the whole
// contract is one POST + one JSON body, and the same code must run on Bun
// locally and Node 20 in production.
//
// Structured output: we ask for strict json_schema (OpenAI structured
// outputs). Some compatible providers reject response_format — Gemini's
// compat layer among them — so on that specific 400 we retry once WITHOUT
// response_format; the prompt already demands bare JSON and every answer is
// zod-validated either way. A model answer we cannot parse or validate is a
// 502, never a silently wrong CRM record.
import { z } from 'zod';
import { env } from '../../config/env.js';
import {
  ExternalServiceError,
  GatewayTimeoutError,
  ServiceUnavailableError,
} from '../../lib/errors.js';

export interface ChatJsonOptions<T> {
  /** Short schema name for response_format (e.g. "lead_score"). */
  name: string;
  system: string;
  user: string;
  /** Strict-subset JSON Schema: additionalProperties:false, all fields required. */
  jsonSchema: Record<string, unknown>;
  /** Zod mirror of jsonSchema — the actual gate on what we accept. */
  parse: z.ZodType<T>;
  temperature?: number;
}

export interface ChatJsonResult<T> {
  value: T;
  /** The model the provider actually reports (may differ from env.AI_MODEL). */
  model: string;
}

function mapNetworkFailure(err: unknown): never {
  // AbortSignal.timeout rejects with a TimeoutError DOMException on both
  // runtimes; anything else is "the provider could not be reached".
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    throw new GatewayTimeoutError('The AI provider timed out');
  }
  throw new ExternalServiceError('The AI provider could not be reached');
}

function extractContent(payload: unknown): { content: string; refusal?: string } {
  const message = (payload as { choices?: { message?: { content?: unknown; refusal?: unknown } }[] })
    ?.choices?.[0]?.message;
  const content = typeof message?.content === 'string' ? message.content : '';
  const refusal = typeof message?.refusal === 'string' ? message.refusal : undefined;
  return { content, refusal };
}

export async function chatJson<T>(options: ChatJsonOptions<T>): Promise<ChatJsonResult<T>> {
  const key = env.AI_API_KEY;
  if (!key) {
    throw new ServiceUnavailableError('AI is not configured (set AI_API_KEY and restart the API)');
  }

  const payload: Record<string, unknown> = {
    model: env.AI_MODEL,
    temperature: options.temperature ?? 0.3,
    messages: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: options.name, strict: true, schema: options.jsonSchema },
    },
  };

  // Trailing-slash normalisation: env copies of the Gemini compat URL end in
  // `/`, and a doubled slash is a 404 on Google's endpoint (verified).
  const endpoint = `${env.AI_BASE_URL.replace(/\/+$/, '')}/chat/completions`;

  const post = (body: unknown): Promise<Response> =>
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
    }).catch(mapNetworkFailure);

  let res = await post(payload);
  let body: Record<string, unknown> = payload;

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // The compat fallback: a 400 that names response_format/json_schema means
    // this provider does not implement structured outputs — retry once with a
    // plain chat request. Zod validation below still guards the answer.
    const rejectsStructuredOutput =
      res.status === 400 && /response_format|json_schema/i.test(detail);
    if (!rejectsStructuredOutput) {
      throw new ExternalServiceError(
        `AI provider answered ${res.status}`,
        // Truncated provider error: enough to debug, no headers/keys.
        detail.slice(0, 300),
      );
    }
    const { response_format: _ignored, ...plain } = payload;
    body = plain;
    res = await post(body);
    if (!res.ok) {
      const retryDetail = await res.text().catch(() => '');
      throw new ExternalServiceError(`AI provider answered ${res.status}`, retryDetail.slice(0, 300));
    }
  }

  const data: unknown = await res.json().catch(() => {
    throw new ExternalServiceError('AI provider returned a non-JSON response');
  });

  const { content, refusal } = extractContent(data);
  if (refusal) throw new ExternalServiceError(`The AI model refused: ${refusal}`);
  if (!content) throw new ExternalServiceError('The AI model returned an empty response');

  // Models occasionally wrap JSON in ```json fences despite the prompt.
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ExternalServiceError('The AI model returned malformed JSON');
  }

  const result = options.parse.safeParse(parsed);
  if (!result.success) {
    throw new ExternalServiceError('The AI model response failed validation', result.error.issues);
  }

  const reportedModel =
    typeof (data as { model?: unknown }).model === 'string'
      ? ((data as { model: string }).model)
      : env.AI_MODEL;
  return { value: result.data, model: reportedModel };
}

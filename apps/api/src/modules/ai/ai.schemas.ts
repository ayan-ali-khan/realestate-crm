// All four AI endpoints take the same optional payload: a short hint the
// agent can add ("focus on budget", "they hated the second property").
// The body itself is optional — POST /score with no body must work — so the
// schema is parsed as `.optional()` (Express 5 leaves req.body undefined
// when no JSON body is sent).
import { z } from 'zod';

export const aiAssistSchema = z.object({
  note: z.string().trim().min(1).max(500).optional(),
});

export type AiAssistInput = z.infer<typeof aiAssistSchema>;

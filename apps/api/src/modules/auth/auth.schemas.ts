import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.email(),
  // bcrypt limit is 72 bytes; zod counts JS string length — close enough as a
  // first line, password.ts enforces the byte limit.
  password: z.string().min(8).max(72),
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

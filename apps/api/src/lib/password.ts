import bcrypt from 'bcrypt';

// bcrypt truncates at 72 bytes; reject longer inputs instead of silently
// ignoring the tail.
const MAX_PASSWORD_BYTES = 72;
const ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  if (Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error('Password exceeds 72 bytes');
  }
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Executes in every vitest worker BEFORE test modules (and therefore before
// src/config/env.ts) are imported.
import { toTestDatabaseUrl } from './db-url.js';

process.env.NODE_ENV = 'test';
if (!process.env.TEST_KEEP_DATABASE_URL) {
  process.env.DATABASE_URL = toTestDatabaseUrl(process.env.DATABASE_URL ?? '');
}
// Fixed, obviously-fake secrets: deterministic signatures in tests only.
process.env.ACCESS_TOKEN_SECRET ??= 'test-access-secret-0123456789abcdef';
process.env.REFRESH_TOKEN_SECRET ??= 'test-refresh-secret-0123456789abcdef';
// Generous limits so the limiter itself never fails an unrelated test.
process.env.RATE_LIMIT_MAX ??= '100000';
process.env.AUTH_RATE_LIMIT_MAX ??= '100000';
// Background jobs: off by default so suites never race a scheduled run.
// The jobs suite enables them explicitly via startJobs({ enabled: true }).
process.env.CRON_ENABLED ??= 'false';
// The suite never spends real money or depends on an upstream: with the key
// gone, every AI endpoint deterministically answers 503 and that is exactly
// what tests/ai.test.ts asserts. Live calls are verified manually against a
// configured provider.
delete process.env.AI_API_KEY;
// Property image uploads: without credentials the multipart endpoints
// deterministically answer 503 and no test can ever touch a real CDN
// (same reasoning as the AI key above).
delete process.env.CLOUDINARY_CLOUD_NAME;
delete process.env.CLOUDINARY_API_KEY;
delete process.env.CLOUDINARY_API_SECRET;

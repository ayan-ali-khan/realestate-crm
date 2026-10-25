// Runs once per vitest run (main process): provisions the *_test database,
// applies migrations, and seeds fixtures. Workers then point at it via setup.ts.
import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { toTestDatabaseUrl, testDatabaseName } from './db-url.js';

export default async function globalSetup(): Promise<void> {
  const devUrl = process.env.DATABASE_URL;
  if (!devUrl) throw new Error('DATABASE_URL is required to provision the test database');
  const testUrl = toTestDatabaseUrl(devUrl);

  const admin = new Client({ connectionString: devUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${testDatabaseName(devUrl)}"`);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== '42P04') throw err; // 42P04 = duplicate_database → already there
  } finally {
    await admin.end();
  }

  const run = (args: string[]) =>
    execFileSync('bunx', ['prisma', ...args], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: testUrl },
      stdio: 'inherit',
    });

  run(['migrate', 'deploy']);
  execFileSync('bun', ['prisma/seed.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
}

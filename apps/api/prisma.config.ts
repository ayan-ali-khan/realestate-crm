// Prisma 7 config: connection URLs for CLI commands (migrate/introspect) live here,
// not in schema.prisma. The runtime client gets its own PrismaPg adapter (see seed.ts,
// and the db client module in Phase 2).
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    seed: 'bun prisma/seed.ts',
  },
});

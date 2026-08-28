import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  out: './src/main/database/migrations/drizzle',
  schema: './src/main/database/schema.ts',
  strict: true,
});

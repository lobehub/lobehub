ALTER TABLE "user_connectors" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'public' NOT NULL;

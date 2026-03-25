-- Migration 0094: shared_agents table for admin-managed agents visible to all users

CREATE TABLE IF NOT EXISTS "shared_agents" (
  "id" text PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "title" varchar(255),
  "description" varchar(1000),
  "avatar" text,
  "background_color" text,
  "tags" jsonb DEFAULT '[]'::jsonb,
  "system_role" text,
  "model" text,
  "provider" text,
  "params" jsonb DEFAULT '{}'::jsonb,
  "plugins" jsonb,
  "chat_config" jsonb,
  "tts" jsonb,
  "opening_message" text,
  "opening_questions" text[] DEFAULT '{}',
  "enabled" boolean DEFAULT true NOT NULL,
  "sort" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

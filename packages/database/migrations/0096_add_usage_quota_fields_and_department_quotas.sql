-- Migration 0093: usage quota fields on users + department_quotas table

-- Add quota columns to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "daily_cost_limit" numeric(20, 6);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "monthly_cost_limit" numeric(20, 6);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "daily_token_limit" integer;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "monthly_token_limit" integer;

-- Create department_quotas table
CREATE TABLE IF NOT EXISTS "department_quotas" (
  "department" varchar(64) PRIMARY KEY NOT NULL,
  "daily_cost_limit" numeric(20, 6),
  "monthly_cost_limit" numeric(20, 6),
  "daily_token_limit" integer,
  "monthly_token_limit" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

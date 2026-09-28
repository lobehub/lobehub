ALTER TABLE "expertise_lessons" ADD COLUMN IF NOT EXISTS "sort_order" integer;--> statement-breakpoint
ALTER TABLE "expertise_lessons" ADD COLUMN IF NOT EXISTS "enforcement" text;

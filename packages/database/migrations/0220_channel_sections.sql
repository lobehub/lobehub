CREATE TABLE IF NOT EXISTS "channel_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"name" text NOT NULL,
	"sort" integer,
	"collapsed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_members" ADD COLUMN IF NOT EXISTS "section_id" uuid;--> statement-breakpoint
ALTER TABLE "channel_members" ADD COLUMN IF NOT EXISTS "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_members" ADD COLUMN IF NOT EXISTS "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_sections" DROP CONSTRAINT IF EXISTS "channel_sections_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "channel_sections" ADD CONSTRAINT "channel_sections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_sections" DROP CONSTRAINT IF EXISTS "channel_sections_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "channel_sections" ADD CONSTRAINT "channel_sections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_sections_user_id_workspace_id_idx" ON "channel_sections" USING btree ("user_id","workspace_id");--> statement-breakpoint
ALTER TABLE "channel_members" DROP CONSTRAINT IF EXISTS "channel_members_section_id_channel_sections_id_fk";--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_section_id_channel_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."channel_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_members_section_id_idx" ON "channel_members" USING btree ("section_id") WHERE "channel_members"."section_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_members" DROP CONSTRAINT IF EXISTS "channel_members_section_id_owner_check";--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_section_id_owner_check" CHECK ("channel_members"."section_id" IS NULL OR "channel_members"."actor_type" = 'user');
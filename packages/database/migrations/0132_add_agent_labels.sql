-- A previous revision of this migration created both tables with a text `id`
-- (prefixed nanoid). Any database that applied it would otherwise keep the old
-- column type, because the journal tag is unchanged and the CREATE statements
-- below are guarded by IF NOT EXISTS. Dropping first is safe: both tables are
-- new, empty, and the feature they back is not live. Assignments go first so
-- the foreign key to agent_labels is gone before that table is dropped.
DROP TABLE IF EXISTS "agent_label_assignments";--> statement-breakpoint
DROP TABLE IF EXISTS "agent_labels";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_label_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"archived" boolean DEFAULT false NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_label_assignments" DROP CONSTRAINT IF EXISTS "agent_label_assignments_label_id_agent_labels_id_fk";--> statement-breakpoint
ALTER TABLE "agent_label_assignments" ADD CONSTRAINT "agent_label_assignments_label_id_agent_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."agent_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_label_assignments" DROP CONSTRAINT IF EXISTS "agent_label_assignments_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_label_assignments" ADD CONSTRAINT "agent_label_assignments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_label_assignments" DROP CONSTRAINT IF EXISTS "agent_label_assignments_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_label_assignments" ADD CONSTRAINT "agent_label_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_label_assignments" DROP CONSTRAINT IF EXISTS "agent_label_assignments_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_label_assignments" ADD CONSTRAINT "agent_label_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_labels" DROP CONSTRAINT IF EXISTS "agent_labels_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_labels" ADD CONSTRAINT "agent_labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_labels" DROP CONSTRAINT IF EXISTS "agent_labels_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "agent_labels" ADD CONSTRAINT "agent_labels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_label_assignments_label_id_agent_id_unique" ON "agent_label_assignments" USING btree ("label_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_label_assignments_agent_id_idx" ON "agent_label_assignments" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_label_assignments_workspace_id_idx" ON "agent_label_assignments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_labels_user_id_idx" ON "agent_labels" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_labels_workspace_id_idx" ON "agent_labels" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_labels_user_id_name_unique" ON "agent_labels" USING btree ("user_id","name") WHERE "agent_labels"."workspace_id" IS NULL AND "agent_labels"."archived" = false;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_labels_workspace_id_name_unique" ON "agent_labels" USING btree ("workspace_id","name") WHERE "agent_labels"."workspace_id" IS NOT NULL AND "agent_labels"."archived" = false;

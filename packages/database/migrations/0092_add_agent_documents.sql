CREATE TABLE IF NOT EXISTS "agent_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"document_id" varchar(255) NOT NULL,
	"template_id" varchar(100),
	"access_self" integer DEFAULT 31 NOT NULL,
	"access_shared" integer DEFAULT 0 NOT NULL,
	"access_public" integer DEFAULT 0 NOT NULL,
	"policy_load" varchar(30) DEFAULT 'always' NOT NULL,
	"policy" jsonb,
	"policy_load_position" varchar(50) DEFAULT 'before-first-user' NOT NULL,
	"policy_load_format" varchar(20) DEFAULT 'raw' NOT NULL,
	"policy_load_rule" varchar(50) DEFAULT 'always' NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" text,
	"deleted_by_agent_id" text,
	"delete_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "agent_documents" DROP CONSTRAINT IF EXISTS "agent_documents_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_documents" DROP CONSTRAINT IF EXISTS "agent_documents_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_documents" DROP CONSTRAINT IF EXISTS "agent_documents_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_documents" DROP CONSTRAINT IF EXISTS "agent_documents_deleted_by_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_documents" DROP CONSTRAINT IF EXISTS "agent_documents_deleted_by_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_deleted_by_agent_id_agents_id_fk" FOREIGN KEY ("deleted_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "agent_documents_user_id_idx" ON "agent_documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_documents_agent_id_idx" ON "agent_documents" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_documents_access_self_idx" ON "agent_documents" USING btree ("access_self");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_documents_access_shared_idx" ON "agent_documents" USING btree ("access_shared");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_documents_access_public_idx" ON "agent_documents" USING btree ("access_public");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_documents_policy_load_idx" ON "agent_documents" USING btree ("policy_load");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_documents_template_id_idx" ON "agent_documents" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_documents_policy_load_position_idx" ON "agent_documents" USING btree ("policy_load_position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_documents_policy_load_format_idx" ON "agent_documents" USING btree ("policy_load_format");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_documents_policy_load_rule_idx" ON "agent_documents" USING btree ("policy_load_rule");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_documents_agent_load_position_idx" ON "agent_documents" USING btree ("agent_id","policy_load_position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_documents_deleted_at_idx" ON "agent_documents" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_documents_agent_autoload_deleted_idx" ON "agent_documents" USING btree ("agent_id","deleted_at","policy_load");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_documents_document_id_idx" ON "agent_documents" USING btree ("document_id");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "agent_documents_agent_document_user_unique" ON "agent_documents" USING btree ("agent_id","document_id","user_id");

CREATE TABLE IF NOT EXISTS "user_contact_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" text NOT NULL,
	"addressee_id" text NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"responded_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_contact_requests_not_self_check" CHECK ("user_contact_requests"."requester_id" <> "user_contact_requests"."addressee_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_contact_tag_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_contact_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"contact_user_id" text,
	"agent_id" text,
	"remark" text,
	"description" text,
	"phones" text[],
	"metadata" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "peer_user_id" text;--> statement-breakpoint
ALTER TABLE "user_contact_requests" DROP CONSTRAINT IF EXISTS "user_contact_requests_requester_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_contact_requests" ADD CONSTRAINT "user_contact_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_contact_requests" DROP CONSTRAINT IF EXISTS "user_contact_requests_addressee_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_contact_requests" ADD CONSTRAINT "user_contact_requests_addressee_id_users_id_fk" FOREIGN KEY ("addressee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_contact_tag_assignments" DROP CONSTRAINT IF EXISTS "user_contact_tag_assignments_tag_id_user_contact_tags_id_fk";--> statement-breakpoint
ALTER TABLE "user_contact_tag_assignments" ADD CONSTRAINT "user_contact_tag_assignments_tag_id_user_contact_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."user_contact_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_contact_tag_assignments" DROP CONSTRAINT IF EXISTS "user_contact_tag_assignments_contact_id_user_contacts_id_fk";--> statement-breakpoint
ALTER TABLE "user_contact_tag_assignments" ADD CONSTRAINT "user_contact_tag_assignments_contact_id_user_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."user_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_contact_tag_assignments" DROP CONSTRAINT IF EXISTS "user_contact_tag_assignments_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_contact_tag_assignments" ADD CONSTRAINT "user_contact_tag_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_contact_tags" DROP CONSTRAINT IF EXISTS "user_contact_tags_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_contact_tags" ADD CONSTRAINT "user_contact_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_contacts" DROP CONSTRAINT IF EXISTS "user_contacts_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_contacts" ADD CONSTRAINT "user_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_contacts" DROP CONSTRAINT IF EXISTS "user_contacts_contact_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_contacts" ADD CONSTRAINT "user_contacts_contact_user_id_users_id_fk" FOREIGN KEY ("contact_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_contacts" DROP CONSTRAINT IF EXISTS "user_contacts_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "user_contacts" ADD CONSTRAINT "user_contacts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_contact_requests_pending_unique" ON "user_contact_requests" USING btree ("requester_id","addressee_id") WHERE "user_contact_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_contact_requests_addressee_status_idx" ON "user_contact_requests" USING btree ("addressee_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_contact_requests_requester_status_idx" ON "user_contact_requests" USING btree ("requester_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_contact_tag_assignments_tag_id_contact_id_unique" ON "user_contact_tag_assignments" USING btree ("tag_id","contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_contact_tag_assignments_contact_id_idx" ON "user_contact_tag_assignments" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_contact_tag_assignments_user_id_idx" ON "user_contact_tag_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_contact_tags_user_id_name_unique" ON "user_contact_tags" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_contacts_user_unique" ON "user_contacts" USING btree ("user_id","contact_user_id") WHERE "user_contacts"."contact_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_contacts_agent_unique" ON "user_contacts" USING btree ("user_id","agent_id") WHERE "user_contacts"."agent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_contacts_contact_user_id_idx" ON "user_contacts" USING btree ("contact_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_contacts_agent_id_idx" ON "user_contacts" USING btree ("agent_id");--> statement-breakpoint
ALTER TABLE "channels" DROP CONSTRAINT IF EXISTS "channels_peer_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_peer_user_id_users_id_fk" FOREIGN KEY ("peer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
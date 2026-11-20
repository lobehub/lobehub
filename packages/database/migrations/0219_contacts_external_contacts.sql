DROP INDEX IF EXISTS "user_contact_requests_pending_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "user_contacts_user_unique";--> statement-breakpoint
ALTER TABLE "user_contact_requests" ADD COLUMN IF NOT EXISTS "workspace_id" text;--> statement-breakpoint
ALTER TABLE "user_contact_requests" DROP CONSTRAINT IF EXISTS "user_contact_requests_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "user_contact_requests" ADD CONSTRAINT "user_contact_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_contact_requests_workspace_pending_unique" ON "user_contact_requests" USING btree ("workspace_id","requester_id","addressee_id") WHERE "user_contact_requests"."status" = 'pending' AND "user_contact_requests"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_contact_requests_workspace_id_idx" ON "user_contact_requests" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_contacts_workspace_user_unique" ON "user_contacts" USING btree ("workspace_id","user_id","contact_user_id") WHERE "user_contacts"."contact_user_id" IS NOT NULL AND "user_contacts"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_contacts_workspace_id_idx" ON "user_contacts" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_contact_requests_pending_unique" ON "user_contact_requests" USING btree ("requester_id","addressee_id") WHERE "user_contact_requests"."status" = 'pending' AND "user_contact_requests"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_contacts_user_unique" ON "user_contacts" USING btree ("user_id","contact_user_id") WHERE "user_contacts"."contact_user_id" IS NOT NULL AND "user_contacts"."workspace_id" IS NULL;

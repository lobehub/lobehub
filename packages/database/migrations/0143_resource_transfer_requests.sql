CREATE TABLE IF NOT EXISTS "resource_transfer_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"initiator_id" text,
	"recipient_id" text,
	"previous_owner_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"options" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resource_transfer_requests" DROP CONSTRAINT IF EXISTS "resource_transfer_requests_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "resource_transfer_requests" ADD CONSTRAINT "resource_transfer_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_transfer_requests" DROP CONSTRAINT IF EXISTS "resource_transfer_requests_initiator_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "resource_transfer_requests" ADD CONSTRAINT "resource_transfer_requests_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_transfer_requests" DROP CONSTRAINT IF EXISTS "resource_transfer_requests_recipient_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "resource_transfer_requests" ADD CONSTRAINT "resource_transfer_requests_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_transfer_requests" DROP CONSTRAINT IF EXISTS "resource_transfer_requests_previous_owner_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "resource_transfer_requests" ADD CONSTRAINT "resource_transfer_requests_previous_owner_id_users_id_fk" FOREIGN KEY ("previous_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resource_transfer_requests_pending_resource_unique" ON "resource_transfer_requests" USING btree ("resource_type","resource_id") WHERE "resource_transfer_requests"."status" = 'pending' AND "resource_transfer_requests"."recipient_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_transfer_requests_recipient_idx" ON "resource_transfer_requests" USING btree ("recipient_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_transfer_requests_workspace_idx" ON "resource_transfer_requests" USING btree ("workspace_id");

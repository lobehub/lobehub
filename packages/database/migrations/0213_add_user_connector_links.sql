CREATE TABLE IF NOT EXISTS "user_connector_links" (
	"id" text PRIMARY KEY NOT NULL,
	"user_connector_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(255) NOT NULL,
	"external_account_id" text,
	"profile" jsonb,
	"status" text NOT NULL,
	"credentials" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_connector_links" DROP CONSTRAINT IF EXISTS "user_connector_links_user_connector_id_user_connectors_id_fk";
--> statement-breakpoint
ALTER TABLE "user_connector_links" ADD CONSTRAINT "user_connector_links_user_connector_id_user_connectors_id_fk" FOREIGN KEY ("user_connector_id") REFERENCES "public"."user_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_connector_links" DROP CONSTRAINT IF EXISTS "user_connector_links_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "user_connector_links" ADD CONSTRAINT "user_connector_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_connector_links_connector_name_unique" ON "user_connector_links" USING btree ("user_connector_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_connector_links_connector_external_account_unique" ON "user_connector_links" USING btree ("user_connector_id","external_account_id") WHERE "user_connector_links"."external_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connector_links_user_id_idx" ON "user_connector_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_connector_links_token_expires_at_idx" ON "user_connector_links" USING btree ("token_expires_at");
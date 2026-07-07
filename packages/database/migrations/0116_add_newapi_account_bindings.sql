CREATE TABLE IF NOT EXISTS "user_newapi_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"newapi_user_id" text,
	"status" varchar(20) NOT NULL,
	"last_provision_error" text,
	"last_provisioned_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_newapi_accounts" DROP CONSTRAINT IF EXISTS "user_newapi_accounts_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_newapi_accounts" ADD CONSTRAINT "user_newapi_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_newapi_accounts_newapi_user_id_unique" ON "user_newapi_accounts" USING btree ("newapi_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_newapi_accounts_status_idx" ON "user_newapi_accounts" USING btree ("status");

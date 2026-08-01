CREATE TABLE IF NOT EXISTS "aico_user_public_ids" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"public_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Nullable first so existing rows can be backfilled before the NOT NULL constraint lands.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "public_code" text;
--> statement-breakpoint
UPDATE "organizations" SET "public_code" = 'ORG' || upper(substr(md5("id"), 1, 6)) WHERE "public_code" IS NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "public_code" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform_trial_config" ADD COLUMN IF NOT EXISTS "trial_budget_usd" numeric(10, 6) DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "aico_user_public_ids" DROP CONSTRAINT IF EXISTS "aico_user_public_ids_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "aico_user_public_ids" ADD CONSTRAINT "aico_user_public_ids_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "aico_user_public_ids_user_id_uidx" ON "aico_user_public_ids" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "aico_user_public_ids_public_code_uidx" ON "aico_user_public_ids" USING btree ("public_code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_public_code_uidx" ON "organizations" USING btree ("public_code");

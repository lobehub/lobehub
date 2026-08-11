-- Platform admin FX rate (toman per 1 USD). Seeded to 187,400.
CREATE TABLE IF NOT EXISTS "platform_fx_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"toman_per_usd" bigint DEFAULT 187400 NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "platform_fx_config" ADD CONSTRAINT "platform_fx_config_updated_by_user_id_users_id_fk"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
INSERT INTO "platform_fx_config" ("id", "toman_per_usd")
VALUES ('default', 187400)
ON CONFLICT ("id") DO UPDATE SET "toman_per_usd" = EXCLUDED."toman_per_usd";

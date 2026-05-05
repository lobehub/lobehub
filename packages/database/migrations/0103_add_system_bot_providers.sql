CREATE TABLE "system_bot_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" varchar(50) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"credentials" text NOT NULL,
	"application_id" varchar(255),
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"connection_mode" varchar(20),
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "system_bot_providers_platform_unique" ON "system_bot_providers" USING btree ("platform");
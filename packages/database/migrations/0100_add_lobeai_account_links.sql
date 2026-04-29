CREATE TABLE IF NOT EXISTS "lobeai_account_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"platform" varchar(50) NOT NULL,
	"platform_user_id" varchar(255) NOT NULL,
	"platform_username" text,
	"active_agent_id" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lobeai_account_links" DROP CONSTRAINT IF EXISTS "lobeai_account_links_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "lobeai_account_links" ADD CONSTRAINT "lobeai_account_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobeai_account_links" DROP CONSTRAINT IF EXISTS "lobeai_account_links_active_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "lobeai_account_links" ADD CONSTRAINT "lobeai_account_links_active_agent_id_agents_id_fk" FOREIGN KEY ("active_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lobeai_account_links_platform_user_unique" ON "lobeai_account_links" USING btree ("platform","platform_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lobeai_account_links_user_platform_unique" ON "lobeai_account_links" USING btree ("user_id","platform");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lobeai_account_links_active_agent_idx" ON "lobeai_account_links" USING btree ("active_agent_id");

CREATE TABLE IF NOT EXISTS "agent_device_pool_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"rules" jsonb NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_pool_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" text NOT NULL,
	"device_id" uuid NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_pools" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"name" text NOT NULL,
	"policy" jsonb NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "pool_managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "agent_device_pool_policies" ADD CONSTRAINT "agent_device_pool_policies_pool_id_device_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."device_pools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "agent_device_pool_policies" ADD CONSTRAINT "agent_device_pool_policies_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "device_pool_devices" ADD CONSTRAINT "device_pool_devices_pool_id_device_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."device_pools"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "device_pool_devices" ADD CONSTRAINT "device_pool_devices_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "device_pools" ADD CONSTRAINT "device_pools_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "device_pools" ADD CONSTRAINT "device_pools_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_device_pool_policies_pool_agent_unique" ON "agent_device_pool_policies" USING btree ("pool_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_device_pool_policies_agent_idx" ON "agent_device_pool_policies" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_pool_devices_pool_device_unique" ON "device_pool_devices" USING btree ("pool_id","device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_pool_devices_device_idx" ON "device_pool_devices" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_pools_scope_idx" ON "device_pools" USING btree ("workspace_id","user_id");
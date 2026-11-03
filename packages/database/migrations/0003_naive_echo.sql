CREATE TABLE IF NOT EXISTS "user_budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"free_budget_id" text,
	"free_budget_key" text,
	"subscription_budget_id" text,
	"subscription_budget_key" text,
	"package_budget_id" text,
	"package_budget_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"stripe_id" text,
	"currency" text,
	"pricing" integer,
	"billing_paid_at" integer,
	"billing_cycle_start" integer,
	"billing_cycle_end" integer,
	"cancel_at_period_end" boolean,
	"cancel_at" integer,
	"next_billing" jsonb,
	"plan" text,
	"recurring" text,
	"storage_limit" integer,
	"status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "preference" DROP DEFAULT;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_budgets" ADD CONSTRAINT "user_budgets_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "key";

CREATE TABLE "ai_models" (
	"id" varchar(150) NOT NULL,
	"display_name" varchar(200),
	"description" text,
	"organization" varchar(100),
	"enabled" boolean,
	"provider_id" varchar(64) NOT NULL,
	"type" varchar(20) DEFAULT 'chat' NOT NULL,
	"sort" integer,
	"user_id" text NOT NULL,
	"pricing" jsonb,
	"parameters" jsonb DEFAULT '{}'::jsonb,
	"config" jsonb,
	"abilities" jsonb DEFAULT '{}'::jsonb,
	"context_window_tokens" integer,
	"source" varchar(20),
	"released_at" varchar(10),
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_models_id_provider_id_user_id_pk" PRIMARY KEY("id","provider_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" varchar(64) NOT NULL,
	"name" text,
	"user_id" text NOT NULL,
	"sort" integer,
	"enabled" boolean,
	"fetch_on_client" boolean,
	"check_model" text,
	"logo" text,
	"description" text,
	"key_vaults" text,
	"source" varchar(20),
	"settings" jsonb,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_providers_id_user_id_pk" PRIMARY KEY("id","user_id")
);
--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
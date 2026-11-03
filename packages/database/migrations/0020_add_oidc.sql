CREATE TABLE IF NOT EXISTS "oidc_access_tokens" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"user_id" text NOT NULL,
	"client_id" varchar(255) NOT NULL,
	"grant_id" varchar(255),
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oidc_authorization_codes" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"user_id" text NOT NULL,
	"client_id" varchar(255) NOT NULL,
	"grant_id" varchar(255),
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oidc_clients" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"client_secret" varchar(255),
	"redirect_uris" text[] NOT NULL,
	"grants" text[] NOT NULL,
	"response_types" text[] NOT NULL,
	"scopes" text[] NOT NULL,
	"token_endpoint_auth_method" varchar(20),
	"application_type" varchar(20),
	"client_uri" text,
	"logo_uri" text,
	"policy_uri" text,
	"tos_uri" text,
	"is_first_party" boolean DEFAULT false,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oidc_consents" (
	"user_id" text NOT NULL,
	"client_id" varchar(255) NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oidc_consents_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oidc_device_codes" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"user_id" text,
	"client_id" varchar(255) NOT NULL,
	"grant_id" varchar(255),
	"user_code" varchar(255),
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oidc_grants" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"user_id" text NOT NULL,
	"client_id" varchar(255) NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oidc_interactions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oidc_refresh_tokens" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"user_id" text NOT NULL,
	"client_id" varchar(255) NOT NULL,
	"grant_id" varchar(255),
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oidc_sessions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_id" text NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "oidc_access_tokens" ADD CONSTRAINT "oidc_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_authorization_codes" ADD CONSTRAINT "oidc_authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_consents" ADD CONSTRAINT "oidc_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_consents" ADD CONSTRAINT "oidc_consents_client_id_oidc_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oidc_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_device_codes" ADD CONSTRAINT "oidc_device_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_grants" ADD CONSTRAINT "oidc_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_refresh_tokens" ADD CONSTRAINT "oidc_refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_sessions" ADD CONSTRAINT "oidc_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

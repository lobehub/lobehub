CREATE TABLE IF NOT EXISTS "nextauth_accounts" (
	"access_token" text,
	"expires_at" integer,
	"id_token" text,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"scope" text,
	"session_state" text,
	"token_type" text,
	"type" text NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "nextauth_accounts_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nextauth_authenticators" (
	"counter" integer NOT NULL,
	"credentialBackedUp" boolean NOT NULL,
	"credentialDeviceType" text NOT NULL,
	"credentialID" text NOT NULL,
	"credentialPublicKey" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"transports" text,
	"userId" text NOT NULL,
	CONSTRAINT "nextauth_authenticators_userId_credentialID_pk" PRIMARY KEY("userId","credentialID"),
	CONSTRAINT "nextauth_authenticators_credentialID_unique" UNIQUE("credentialID")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nextauth_sessions" (
	"expires" timestamp NOT NULL,
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nextauth_verificationtokens" (
	"expires" timestamp NOT NULL,
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	CONSTRAINT "nextauth_verificationtokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "full_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nextauth_accounts" ADD CONSTRAINT "nextauth_accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nextauth_authenticators" ADD CONSTRAINT "nextauth_authenticators_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nextauth_sessions" ADD CONSTRAINT "nextauth_sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

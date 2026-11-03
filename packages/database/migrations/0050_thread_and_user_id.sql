ALTER TABLE "nextauth_accounts" RENAME COLUMN "userId" TO "user_id";--> statement-breakpoint
ALTER TABLE "nextauth_authenticators" RENAME COLUMN "userId" TO "user_id";--> statement-breakpoint
ALTER TABLE "nextauth_sessions" RENAME COLUMN "userId" TO "user_id";--> statement-breakpoint
ALTER TABLE "nextauth_accounts" DROP CONSTRAINT "nextauth_accounts_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "nextauth_authenticators" DROP CONSTRAINT "nextauth_authenticators_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "nextauth_sessions" DROP CONSTRAINT "nextauth_sessions_userId_users_id_fk";
--> statement-breakpoint
ALTER TABLE "nextauth_authenticators" DROP CONSTRAINT "nextauth_authenticators_userId_credentialID_pk";--> statement-breakpoint
ALTER TABLE "threads" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "threads" ALTER COLUMN "source_message_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "nextauth_authenticators" ADD CONSTRAINT "nextauth_authenticators_user_id_credentialID_pk" PRIMARY KEY("user_id","credentialID");--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "content" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "editor_data" jsonb;--> statement-breakpoint
ALTER TABLE "nextauth_accounts" ADD CONSTRAINT "nextauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nextauth_authenticators" ADD CONSTRAINT "nextauth_authenticators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nextauth_sessions" ADD CONSTRAINT "nextauth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

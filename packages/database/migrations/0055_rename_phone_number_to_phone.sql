ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_phone_number_unique";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "phone_number";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_phone_unique";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_unique" UNIQUE("phone");

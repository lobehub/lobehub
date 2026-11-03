ALTER TABLE "agents" DROP CONSTRAINT "agents_slug_unique";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agents_slug_user_id_unique" ON "agents" USING btree ("slug","user_id");

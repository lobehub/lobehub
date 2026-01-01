ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "session_group_id" text;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_session_group_id_session_groups_id_fk') THEN
    ALTER TABLE "agents" ADD CONSTRAINT "agents_session_group_id_session_groups_id_fk" FOREIGN KEY ("session_group_id") REFERENCES "public"."session_groups"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_session_group_id_idx" ON "agents" USING btree ("session_group_id");

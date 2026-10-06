ALTER TABLE "expertise_hits" ADD COLUMN IF NOT EXISTS "source_message_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "expertise_hits" ADD CONSTRAINT "expertise_hits_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "expertise_hits" VALIDATE CONSTRAINT "expertise_hits_source_message_id_messages_id_fk";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_hits_source_message_idx" ON "expertise_hits" USING btree ("source_message_id") WHERE "expertise_hits"."source_message_id" is not null;

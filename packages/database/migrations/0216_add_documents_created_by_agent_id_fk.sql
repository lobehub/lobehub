DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documents_created_by_agent_id_agents_id_fk'
      AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action NOT VALID;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_created_by_agent_id_idx" ON "documents" USING btree ("created_by_agent_id") WHERE "documents"."created_by_agent_id" is not null;

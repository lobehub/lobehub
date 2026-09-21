CREATE SEQUENCE IF NOT EXISTS "public"."fts_search_sync_revision_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fts_search_sync_outbox" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dead_at" timestamp with time zone,
	"document_id" text NOT NULL,
	"entity" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"last_error" text,
	"locked_until" timestamp with time zone,
	"priority" smallint DEFAULT 10 NOT NULL,
	"revision" bigint DEFAULT nextval('fts_search_sync_revision_seq') NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fts_search_sync_outbox_entity_document_id_unique" ON "fts_search_sync_outbox" USING btree ("entity","document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fts_search_sync_outbox_claim_idx" ON "fts_search_sync_outbox" USING btree ("priority","available_at","revision") WHERE "fts_search_sync_outbox"."dead_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fts_search_sync_outbox_dead_idx" ON "fts_search_sync_outbox" USING btree ("dead_at") WHERE "fts_search_sync_outbox"."dead_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fts_search_sync_outbox_lease_idx" ON "fts_search_sync_outbox" USING btree ("locked_until") WHERE "fts_search_sync_outbox"."dead_at" IS NULL AND "fts_search_sync_outbox"."locked_until" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_contexts_user_memory_ids_gin_idx" ON "user_memories_contexts" USING gin ("user_memory_ids");

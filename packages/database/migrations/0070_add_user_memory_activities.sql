CREATE TABLE IF NOT EXISTS "user_memories_activities" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" text,
	"user_memory_id" varchar(255),
	"metadata" jsonb,
	"tags" text[],
	"type" varchar(255) NOT NULL,
	"status" varchar(255) DEFAULT 'pending' NOT NULL,
	"timezone" varchar(255),
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"associated_objects" jsonb,
	"associated_subjects" jsonb,
	"associated_locations" jsonb,
	"notes" text,
	"narrative" text,
	"narrative_vector" vector(1024),
	"feedback" text,
	"feedback_vector" vector(1024),
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_memories_activities" DROP CONSTRAINT IF EXISTS "user_memories_activities_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_memories_activities" ADD CONSTRAINT "user_memories_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories_activities" DROP CONSTRAINT IF EXISTS "user_memories_activities_user_memory_id_user_memories_id_fk";--> statement-breakpoint
ALTER TABLE "user_memories_activities" ADD CONSTRAINT "user_memories_activities_user_memory_id_user_memories_id_fk" FOREIGN KEY ("user_memory_id") REFERENCES "public"."user_memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_activities_narrative_vector_index" ON "user_memories_activities" USING hnsw ("narrative_vector" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_activities_feedback_vector_index" ON "user_memories_activities" USING hnsw ("feedback_vector" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_activities_type_index" ON "user_memories_activities" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_activities_user_id_index" ON "user_memories_activities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_activities_user_memory_id_index" ON "user_memories_activities" USING btree ("user_memory_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memories_activities_status_index" ON "user_memories_activities" USING btree ("status");

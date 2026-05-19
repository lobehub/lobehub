CREATE TABLE "audio_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"prompt" text NOT NULL,
	"music_style" text NOT NULL,
	"duration" integer NOT NULL,
	"model_version" text DEFAULT 'v5.5' NOT NULL,
	"task_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"audio_url" text,
	"audio_metadata" jsonb,
	"error" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_generations_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
ALTER TABLE "audio_generations" ADD CONSTRAINT "audio_generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_generations_user_id_idx" ON "audio_generations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audio_generations_status_idx" ON "audio_generations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audio_generations_created_at_idx" ON "audio_generations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audio_generations_task_id_idx" ON "audio_generations" USING btree ("task_id");
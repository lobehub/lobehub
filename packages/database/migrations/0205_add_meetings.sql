CREATE TABLE IF NOT EXISTS "meeting_minutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" text NOT NULL,
	"summary" text,
	"chapters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"document_id" text,
	"model" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" text NOT NULL,
	"speaker_id" uuid,
	"source" text NOT NULL,
	"seq" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"text" text NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_speakers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" text NOT NULL,
	"label" text NOT NULL,
	"display_name" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"title" text NOT NULL,
	"status" text DEFAULT 'recording' NOT NULL,
	"platform" text NOT NULL,
	"realtime_provider" text NOT NULL,
	"refine_provider" text NOT NULL,
	"language" text DEFAULT 'auto' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_ms" integer,
	"audio_file_id" text,
	"local_audio_path" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_minutes" DROP CONSTRAINT IF EXISTS "meeting_minutes_meeting_id_meetings_id_fk";--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_minutes" DROP CONSTRAINT IF EXISTS "meeting_minutes_document_id_documents_id_fk";--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD CONSTRAINT "meeting_minutes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_segments" DROP CONSTRAINT IF EXISTS "meeting_segments_meeting_id_meetings_id_fk";--> statement-breakpoint
ALTER TABLE "meeting_segments" ADD CONSTRAINT "meeting_segments_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_segments" DROP CONSTRAINT IF EXISTS "meeting_segments_speaker_id_meeting_speakers_id_fk";--> statement-breakpoint
ALTER TABLE "meeting_segments" ADD CONSTRAINT "meeting_segments_speaker_id_meeting_speakers_id_fk" FOREIGN KEY ("speaker_id") REFERENCES "public"."meeting_speakers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_speakers" DROP CONSTRAINT IF EXISTS "meeting_speakers_meeting_id_meetings_id_fk";--> statement-breakpoint
ALTER TABLE "meeting_speakers" ADD CONSTRAINT "meeting_speakers_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" DROP CONSTRAINT IF EXISTS "meetings_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" DROP CONSTRAINT IF EXISTS "meetings_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" DROP CONSTRAINT IF EXISTS "meetings_audio_file_id_files_id_fk";--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_audio_file_id_files_id_fk" FOREIGN KEY ("audio_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_minutes_meeting_id_unique" ON "meeting_minutes" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_minutes_document_id_idx" ON "meeting_minutes" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_segments_meeting_id_source_seq_unique" ON "meeting_segments" USING btree ("meeting_id","source","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_segments_meeting_id_source_start_ms_idx" ON "meeting_segments" USING btree ("meeting_id","source","start_ms");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meeting_segments_speaker_id_idx" ON "meeting_segments" USING btree ("speaker_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_speakers_meeting_id_label_unique" ON "meeting_speakers" USING btree ("meeting_id","label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_user_id_workspace_id_created_at_idx" ON "meetings" USING btree ("user_id","workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_workspace_id_created_at_idx" ON "meetings" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meetings_audio_file_id_idx" ON "meetings" USING btree ("audio_file_id");
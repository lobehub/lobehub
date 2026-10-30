CREATE TABLE IF NOT EXISTS "channel_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" text NOT NULL,
	"event" text NOT NULL,
	"target_id" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"thread_id" text,
	"requester_member_id" uuid NOT NULL,
	"delivery_key" text DEFAULT 'initial' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"blocked_reason" text,
	"blocked_code" text,
	"claimed_at" timestamp with time zone,
	"topic_id" text,
	"operation_id" text,
	"manifest" jsonb,
	"execution_config" jsonb,
	"device_id" varchar(64),
	"working_directory" text,
	"accepted_at" timestamp with time zone,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"writer_held" boolean DEFAULT false NOT NULL,
	"isolated_at" timestamp with time zone,
	"draft" text,
	"publication_revoked" boolean DEFAULT false NOT NULL,
	"published_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_jobs_operation_id_unique" UNIQUE("operation_id"),
	CONSTRAINT "channel_jobs_scope_unique" UNIQUE("channel_id","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_member_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" text NOT NULL,
	"member_id" uuid NOT NULL,
	"device_owner_id" text NOT NULL,
	"device_id" varchar(64) NOT NULL,
	"working_directory" text NOT NULL,
	"requested_by_member_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"user_id" text,
	"role" text,
	"last_read_sequence" integer,
	"agent_id" text,
	"name" text,
	"description" text DEFAULT '' NOT NULL,
	"config" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_members_scope_unique" UNIQUE("channel_id","id"),
	CONSTRAINT "channel_members_actor_type_check" CHECK ("channel_members"."actor_type" IN ('user', 'agent')),
	CONSTRAINT "channel_members_user_shape_check" CHECK ("channel_members"."actor_type" <> 'user' OR "channel_members"."role" IS NOT NULL),
	CONSTRAINT "channel_members_agent_shape_check" CHECK ("channel_members"."actor_type" <> 'agent' OR ("channel_members"."name" IS NOT NULL AND "channel_members"."config" IS NOT NULL)),
	CONSTRAINT "channel_members_user_id_owner_check" CHECK ("channel_members"."user_id" IS NULL OR "channel_members"."actor_type" = 'user'),
	CONSTRAINT "channel_members_role_owner_check" CHECK ("channel_members"."role" IS NULL OR "channel_members"."actor_type" = 'user'),
	CONSTRAINT "channel_members_agent_id_owner_check" CHECK ("channel_members"."agent_id" IS NULL OR "channel_members"."actor_type" = 'agent'),
	CONSTRAINT "channel_members_config_owner_check" CHECK ("channel_members"."config" IS NULL OR "channel_members"."actor_type" <> 'user')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_message_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"file_id" text NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "channel_message_files_message_file_unique" UNIQUE("message_id","file_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" text NOT NULL,
	"thread_id" text,
	"sequence" integer NOT NULL,
	"content" text NOT NULL,
	"user_id" text,
	"agent_id" text,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"request_key" text NOT NULL,
	"reply_to_id" uuid,
	"routing_status" text NOT NULL,
	"routing_source" text,
	"routing_reason" text,
	"routing_attempt" integer DEFAULT 0 NOT NULL,
	"recipient_member_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_messages_scope_unique" UNIQUE("channel_id","id"),
	CONSTRAINT "channel_messages_sender_check" CHECK ("channel_messages"."user_id" IS NULL OR "channel_messages"."agent_id" IS NULL),
	CONSTRAINT "channel_messages_user_sender_check" CHECK ("channel_messages"."routing_status" <> 'reply' OR "channel_messages"."user_id" IS NULL),
	CONSTRAINT "channel_messages_agent_sender_check" CHECK ("channel_messages"."routing_status" = 'reply' OR "channel_messages"."agent_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"root_message_id" uuid NOT NULL,
	"root_sequence" integer NOT NULL,
	"follower_member_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_threads_scope_unique" UNIQUE("channel_id","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"workspace_id" text,
	"project_id" text,
	"agent_id" text,
	"title" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_direct_visibility_check" CHECK ("channels"."agent_id" IS NULL OR "channels"."visibility" = 'private')
);
--> statement-breakpoint
ALTER TABLE "channel_audit" DROP CONSTRAINT IF EXISTS "channel_audit_channel_id_channels_id_fk";--> statement-breakpoint
ALTER TABLE "channel_audit" ADD CONSTRAINT "channel_audit_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_jobs" DROP CONSTRAINT IF EXISTS "channel_jobs_channel_id_channels_id_fk";--> statement-breakpoint
ALTER TABLE "channel_jobs" ADD CONSTRAINT "channel_jobs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_jobs" DROP CONSTRAINT IF EXISTS "channel_jobs_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "channel_jobs" ADD CONSTRAINT "channel_jobs_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_jobs" DROP CONSTRAINT IF EXISTS "channel_jobs_operation_id_agent_operations_id_fk";--> statement-breakpoint
ALTER TABLE "channel_jobs" ADD CONSTRAINT "channel_jobs_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_jobs" DROP CONSTRAINT IF EXISTS "channel_jobs_member_fk";--> statement-breakpoint
ALTER TABLE "channel_jobs" ADD CONSTRAINT "channel_jobs_member_fk" FOREIGN KEY ("channel_id","member_id") REFERENCES "public"."channel_members"("channel_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_jobs" DROP CONSTRAINT IF EXISTS "channel_jobs_requester_fk";--> statement-breakpoint
ALTER TABLE "channel_jobs" ADD CONSTRAINT "channel_jobs_requester_fk" FOREIGN KEY ("channel_id","requester_member_id") REFERENCES "public"."channel_members"("channel_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_jobs" DROP CONSTRAINT IF EXISTS "channel_jobs_message_fk";--> statement-breakpoint
ALTER TABLE "channel_jobs" ADD CONSTRAINT "channel_jobs_message_fk" FOREIGN KEY ("channel_id","message_id") REFERENCES "public"."channel_messages"("channel_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_jobs" DROP CONSTRAINT IF EXISTS "channel_jobs_thread_fk";--> statement-breakpoint
ALTER TABLE "channel_jobs" ADD CONSTRAINT "channel_jobs_thread_fk" FOREIGN KEY ("channel_id","thread_id") REFERENCES "public"."channel_threads"("channel_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_member_grants" DROP CONSTRAINT IF EXISTS "channel_member_grants_channel_id_channels_id_fk";--> statement-breakpoint
ALTER TABLE "channel_member_grants" ADD CONSTRAINT "channel_member_grants_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_member_grants" DROP CONSTRAINT IF EXISTS "channel_member_grants_device_owner_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "channel_member_grants" ADD CONSTRAINT "channel_member_grants_device_owner_id_users_id_fk" FOREIGN KEY ("device_owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_member_grants" DROP CONSTRAINT IF EXISTS "channel_member_grants_member_fk";--> statement-breakpoint
ALTER TABLE "channel_member_grants" ADD CONSTRAINT "channel_member_grants_member_fk" FOREIGN KEY ("channel_id","member_id") REFERENCES "public"."channel_members"("channel_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_member_grants" DROP CONSTRAINT IF EXISTS "channel_member_grants_requester_fk";--> statement-breakpoint
ALTER TABLE "channel_member_grants" ADD CONSTRAINT "channel_member_grants_requester_fk" FOREIGN KEY ("channel_id","requested_by_member_id") REFERENCES "public"."channel_members"("channel_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_members" DROP CONSTRAINT IF EXISTS "channel_members_channel_id_channels_id_fk";--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_members" DROP CONSTRAINT IF EXISTS "channel_members_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_members" DROP CONSTRAINT IF EXISTS "channel_members_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message_files" DROP CONSTRAINT IF EXISTS "channel_message_files_message_id_channel_messages_id_fk";--> statement-breakpoint
ALTER TABLE "channel_message_files" ADD CONSTRAINT "channel_message_files_message_id_channel_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."channel_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message_files" DROP CONSTRAINT IF EXISTS "channel_message_files_file_id_files_id_fk";--> statement-breakpoint
ALTER TABLE "channel_message_files" ADD CONSTRAINT "channel_message_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" DROP CONSTRAINT IF EXISTS "channel_messages_channel_id_channels_id_fk";--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" DROP CONSTRAINT IF EXISTS "channel_messages_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" DROP CONSTRAINT IF EXISTS "channel_messages_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_messages" DROP CONSTRAINT IF EXISTS "channel_messages_thread_fk";--> statement-breakpoint
ALTER TABLE "channel_messages" ADD CONSTRAINT "channel_messages_thread_fk" FOREIGN KEY ("channel_id","thread_id") REFERENCES "public"."channel_threads"("channel_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_threads" DROP CONSTRAINT IF EXISTS "channel_threads_channel_id_channels_id_fk";--> statement-breakpoint
ALTER TABLE "channel_threads" ADD CONSTRAINT "channel_threads_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_threads" DROP CONSTRAINT IF EXISTS "channel_threads_root_fk";--> statement-breakpoint
ALTER TABLE "channel_threads" ADD CONSTRAINT "channel_threads_root_fk" FOREIGN KEY ("channel_id","root_message_id") REFERENCES "public"."channel_messages"("channel_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" DROP CONSTRAINT IF EXISTS "channels_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" DROP CONSTRAINT IF EXISTS "channels_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" DROP CONSTRAINT IF EXISTS "channels_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" DROP CONSTRAINT IF EXISTS "channels_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_audit_channel_event_idx" ON "channel_audit" USING btree ("channel_id","event","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_audit_target_event_idx" ON "channel_audit" USING btree ("target_id","event","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_jobs_delivery_unique" ON "channel_jobs" USING btree ("message_id","member_id","delivery_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_jobs_channel_status_idx" ON "channel_jobs" USING btree ("channel_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_jobs_continuation_idx" ON "channel_jobs" USING btree ("member_id","requester_member_id","thread_id","claimed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_jobs_topic_idx" ON "channel_jobs" USING btree ("topic_id","published_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_jobs_member_queue_idx" ON "channel_jobs" USING btree ("member_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_jobs_lease_expires_idx" ON "channel_jobs" USING btree ("lease_expires_at") WHERE "channel_jobs"."writer_held" AND "channel_jobs"."isolated_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_jobs_active_member_unique" ON "channel_jobs" USING btree ("member_id") WHERE "channel_jobs"."writer_held" AND "channel_jobs"."isolated_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_jobs_active_directory_unique" ON "channel_jobs" USING btree ("device_id","working_directory") WHERE "channel_jobs"."device_id" IS NOT NULL AND "channel_jobs"."working_directory" IS NOT NULL AND "channel_jobs"."writer_held";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_member_grants_member_unique" ON "channel_member_grants" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_member_grants_owner_status_idx" ON "channel_member_grants" USING btree ("device_owner_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_members_channel_user_unique" ON "channel_members" USING btree ("channel_id","user_id") WHERE "channel_members"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_members_user_id_idx" ON "channel_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_members_agent_id_idx" ON "channel_members" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_message_files_file_idx" ON "channel_message_files" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_messages_sequence_unique" ON "channel_messages" USING btree ("channel_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_messages_request_key_unique" ON "channel_messages" USING btree ("channel_id","request_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_messages_thread_sequence_idx" ON "channel_messages" USING btree ("channel_id","thread_id","sequence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_messages_request_sequence_idx" ON "channel_messages" USING btree ("channel_id","thread_id","sequence") WHERE "channel_messages"."routing_status" <> 'reply';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_messages_routing_pending_idx" ON "channel_messages" USING btree ("channel_id","id") WHERE "channel_messages"."routing_status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_threads_root_unique" ON "channel_threads" USING btree ("channel_id","root_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channels_user_id_idx" ON "channels" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channels_direct_unique" ON "channels" USING btree ("agent_id","user_id",coalesce("workspace_id", '')) WHERE "channels"."agent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channels_project_id_idx" ON "channels" USING btree ("project_id") WHERE "channels"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channels_workspace_visibility_idx" ON "channels" USING btree ("workspace_id","visibility");

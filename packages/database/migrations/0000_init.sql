CREATE TABLE IF NOT EXISTS "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar(100),
	"title" text,
	"description" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"avatar" text,
	"background_color" text,
	"plugins" jsonb DEFAULT '[]'::jsonb,
	"user_id" text NOT NULL,
	"chat_config" jsonb,
	"few_shots" jsonb,
	"model" text,
	"params" jsonb DEFAULT '{}'::jsonb,
	"provider" text,
	"system_role" text,
	"tts" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents_tags" (
	"agent_id" text NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "agents_tags_agent_id_tag_id_pk" PRIMARY KEY("agent_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents_to_sessions" (
	"agent_id" text NOT NULL,
	"session_id" text NOT NULL,
	CONSTRAINT "agents_to_sessions_agent_id_session_id_pk" PRIMARY KEY("agent_id","session_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "files" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"file_type" varchar(255) NOT NULL,
	"name" text NOT NULL,
	"size" integer NOT NULL,
	"url" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "files_to_agents" (
	"file_id" text NOT NULL,
	"agent_id" text NOT NULL,
	CONSTRAINT "files_to_agents_file_id_agent_id_pk" PRIMARY KEY("file_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "files_to_messages" (
	"file_id" text NOT NULL,
	"message_id" text NOT NULL,
	CONSTRAINT "files_to_messages_file_id_message_id_pk" PRIMARY KEY("file_id","message_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "files_to_sessions" (
	"file_id" text NOT NULL,
	"session_id" text NOT NULL,
	CONSTRAINT "files_to_sessions_file_id_session_id_pk" PRIMARY KEY("file_id","session_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_installed_plugins" (
	"user_id" text NOT NULL,
	"identifier" text NOT NULL,
	"type" text NOT NULL,
	"manifest" jsonb,
	"settings" jsonb,
	"custom_params" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_installed_plugins_user_id_identifier_pk" PRIMARY KEY("user_id","identifier")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text,
	"plugin_id" integer,
	"type" text NOT NULL,
	"view" integer DEFAULT 0,
	"like" integer DEFAULT 0,
	"used" integer DEFAULT 0,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_plugins" (
	"id" text PRIMARY KEY NOT NULL,
	"tool_call_id" text,
	"type" text DEFAULT 'default',
	"api_name" text,
	"arguments" text,
	"identifier" text,
	"state" jsonb,
	"error" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_tts" (
	"id" text PRIMARY KEY NOT NULL,
	"content_md5" text,
	"file_id" text,
	"voice" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_translates" (
	"id" text PRIMARY KEY NOT NULL,
	"content" text,
	"from" text,
	"to" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"content" text,
	"model" text,
	"provider" text,
	"favorite" boolean DEFAULT false,
	"error" jsonb,
	"tools" jsonb,
	"trace_id" text,
	"observation_id" text,
	"user_id" text NOT NULL,
	"session_id" text,
	"topic_id" text,
	"parent_id" text,
	"quota_id" text,
	"agent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugins" (
	"id" serial PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"avatar" text,
	"author" text,
	"manifest" text NOT NULL,
	"locale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugins_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugins_tags" (
	"plugin_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "plugins_tags_plugin_id_tag_id_pk" PRIMARY KEY("plugin_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort" integer,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" varchar(100) NOT NULL,
	"title" text,
	"description" text,
	"avatar" text,
	"background_color" text,
	"type" text DEFAULT 'agent',
	"user_id" text NOT NULL,
	"group_id" text,
	"pinned" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "topics" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"favorite" boolean DEFAULT false,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"tts" jsonb,
	"key_vaults" text,
	"general" jsonb,
	"language_model" jsonb,
	"system_agent" jsonb,
	"default_agent" jsonb,
	"tool" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text,
	"email" text,
	"avatar" text,
	"phone" text,
	"first_name" text,
	"last_name" text,
	"is_onboarded" boolean DEFAULT false,
	"clerk_created_at" timestamp with time zone,
	"preference" jsonb DEFAULT '{"guide":{"moveSettingsToAvatar":true,"topic":true},"telemetry":null,"useCmdEnterToSend":false}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents_tags" ADD CONSTRAINT "agents_tags_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents_tags" ADD CONSTRAINT "agents_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents_to_sessions" ADD CONSTRAINT "agents_to_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agents_to_sessions" ADD CONSTRAINT "agents_to_sessions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files" ADD CONSTRAINT "files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files_to_agents" ADD CONSTRAINT "files_to_agents_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files_to_agents" ADD CONSTRAINT "files_to_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files_to_messages" ADD CONSTRAINT "files_to_messages_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files_to_messages" ADD CONSTRAINT "files_to_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files_to_sessions" ADD CONSTRAINT "files_to_sessions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "files_to_sessions" ADD CONSTRAINT "files_to_sessions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_installed_plugins" ADD CONSTRAINT "user_installed_plugins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market" ADD CONSTRAINT "market_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market" ADD CONSTRAINT "market_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market" ADD CONSTRAINT "market_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_plugins" ADD CONSTRAINT "message_plugins_id_messages_id_fk" FOREIGN KEY ("id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_tts" ADD CONSTRAINT "message_tts_id_messages_id_fk" FOREIGN KEY ("id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_tts" ADD CONSTRAINT "message_tts_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_translates" ADD CONSTRAINT "message_translates_id_messages_id_fk" FOREIGN KEY ("id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_parent_id_messages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_quota_id_messages_id_fk" FOREIGN KEY ("quota_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plugins_tags" ADD CONSTRAINT "plugins_tags_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plugins_tags" ADD CONSTRAINT "plugins_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session_groups" ADD CONSTRAINT "session_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_group_id_session_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."session_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topics" ADD CONSTRAINT "topics_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topics" ADD CONSTRAINT "topics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_created_at_idx" ON "messages" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "slug_user_id_unique" ON "sessions" ("slug","user_id");

CREATE TABLE IF NOT EXISTS "channel_message_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_emojis" (
	"id" text PRIMARY KEY NOT NULL,
	"pack_id" text NOT NULL,
	"user_id" text,
	"file_hash" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bound_emojis" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"animated" boolean DEFAULT false NOT NULL,
	"width" integer,
	"height" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"removed_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emoji_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"user_id" text,
	"workspace_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"removed_at" timestamp with time zone,
	"visibility" text DEFAULT 'private' NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emoji_packs_user_shape_check" CHECK ("emoji_packs"."scope" <> 'user' OR ("emoji_packs"."user_id" IS NOT NULL AND "emoji_packs"."workspace_id" IS NULL)),
	CONSTRAINT "emoji_packs_workspace_shape_check" CHECK ("emoji_packs"."scope" <> 'workspace' OR ("emoji_packs"."workspace_id" IS NOT NULL AND "emoji_packs"."user_id" IS NULL)),
	CONSTRAINT "emoji_packs_favorites_owner_check" CHECK ("emoji_packs"."kind" <> 'favorites' OR "emoji_packs"."scope" = 'user')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_emoji_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"pack_id" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_message_reactions" DROP CONSTRAINT IF EXISTS "channel_message_reactions_channel_id_channels_id_fk";--> statement-breakpoint
ALTER TABLE "channel_message_reactions" ADD CONSTRAINT "channel_message_reactions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message_reactions" DROP CONSTRAINT IF EXISTS "channel_message_reactions_message_fk";--> statement-breakpoint
ALTER TABLE "channel_message_reactions" ADD CONSTRAINT "channel_message_reactions_message_fk" FOREIGN KEY ("channel_id","message_id") REFERENCES "public"."channel_messages"("channel_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_message_reactions" DROP CONSTRAINT IF EXISTS "channel_message_reactions_member_fk";--> statement-breakpoint
ALTER TABLE "channel_message_reactions" ADD CONSTRAINT "channel_message_reactions_member_fk" FOREIGN KEY ("channel_id","member_id") REFERENCES "public"."channel_members"("channel_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_emojis" DROP CONSTRAINT IF EXISTS "custom_emojis_pack_id_emoji_packs_id_fk";--> statement-breakpoint
ALTER TABLE "custom_emojis" ADD CONSTRAINT "custom_emojis_pack_id_emoji_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."emoji_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_emojis" DROP CONSTRAINT IF EXISTS "custom_emojis_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "custom_emojis" ADD CONSTRAINT "custom_emojis_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_emojis" DROP CONSTRAINT IF EXISTS "custom_emojis_file_hash_global_files_hash_id_fk";--> statement-breakpoint
ALTER TABLE "custom_emojis" ADD CONSTRAINT "custom_emojis_file_hash_global_files_hash_id_fk" FOREIGN KEY ("file_hash") REFERENCES "public"."global_files"("hash_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emoji_packs" DROP CONSTRAINT IF EXISTS "emoji_packs_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "emoji_packs" ADD CONSTRAINT "emoji_packs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emoji_packs" DROP CONSTRAINT IF EXISTS "emoji_packs_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "emoji_packs" ADD CONSTRAINT "emoji_packs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_emoji_packs" DROP CONSTRAINT IF EXISTS "user_emoji_packs_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_emoji_packs" ADD CONSTRAINT "user_emoji_packs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_emoji_packs" DROP CONSTRAINT IF EXISTS "user_emoji_packs_pack_id_emoji_packs_id_fk";--> statement-breakpoint
ALTER TABLE "user_emoji_packs" ADD CONSTRAINT "user_emoji_packs_pack_id_emoji_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."emoji_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_message_reactions_message_member_emoji_unique" ON "channel_message_reactions" USING btree ("message_id","member_id","emoji");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_message_reactions_channel_member_idx" ON "channel_message_reactions" USING btree ("channel_id","member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_emojis_pack_id_sort_order_idx" ON "custom_emojis" USING btree ("pack_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_emojis_file_hash_idx" ON "custom_emojis" USING btree ("file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_emojis_pack_id_name_unique" ON "custom_emojis" USING btree ("pack_id","name") WHERE "custom_emojis"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "emoji_packs_user_id_idx" ON "emoji_packs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "emoji_packs_workspace_id_idx" ON "emoji_packs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "emoji_packs_user_favorites_unique" ON "emoji_packs" USING btree ("user_id") WHERE "emoji_packs"."kind" = 'favorites' AND "emoji_packs"."removed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_emoji_packs_user_id_pack_id_unique" ON "user_emoji_packs" USING btree ("user_id","pack_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_emoji_packs_pack_id_idx" ON "user_emoji_packs" USING btree ("pack_id");
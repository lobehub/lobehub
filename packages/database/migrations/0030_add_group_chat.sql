CREATE TABLE IF NOT EXISTS "chat_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text,
	"description" text,
	"config" jsonb,
	"client_id" text,
	"user_id" text NOT NULL,
	"pinned" boolean DEFAULT false,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_groups_agents" (
	"chat_group_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"order" integer DEFAULT 0,
	"role" text DEFAULT 'participant',
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_groups_agents_chat_group_id_agent_id_pk" PRIMARY KEY("chat_group_id","agent_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "group_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "target_id" text;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN IF NOT EXISTS "group_id" text;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_chat_group_id_chat_groups_id_fk" FOREIGN KEY ("chat_group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_groups_agents" ADD CONSTRAINT "chat_groups_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_groups_client_id_user_id_unique" ON "chat_groups" USING btree ("client_id","user_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_group_id_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_group_id_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."chat_groups"("id") ON DELETE cascade ON UPDATE no action;

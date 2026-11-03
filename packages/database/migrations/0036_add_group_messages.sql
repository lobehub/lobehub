CREATE TABLE IF NOT EXISTS "message_groups" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"topic_id" text,
	"user_id" text NOT NULL,
	"parent_group_id" varchar(255),
	"parent_message_id" text,
	"title" varchar(255),
	"description" text,
	"client_id" varchar(255),
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "message_group_id" varchar(255);--> statement-breakpoint
ALTER TABLE "message_groups" ADD CONSTRAINT "message_groups_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_groups" ADD CONSTRAINT "message_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_groups" ADD CONSTRAINT "message_groups_parent_group_id_message_groups_id_fk" FOREIGN KEY ("parent_group_id") REFERENCES "public"."message_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_groups" ADD CONSTRAINT "message_groups_parent_message_id_messages_id_fk" FOREIGN KEY ("parent_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_groups_client_id_user_id_unique" ON "message_groups" USING btree ("client_id","user_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_message_group_id_message_groups_id_fk" FOREIGN KEY ("message_group_id") REFERENCES "public"."message_groups"("id") ON DELETE cascade ON UPDATE no action;

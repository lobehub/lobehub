CREATE TABLE IF NOT EXISTS "user_task_template_interactions" (
	"user_id" text NOT NULL,
	"template_id" varchar(64) NOT NULL,
	"first_created_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_task_template_interactions_user_id_template_id_pk" PRIMARY KEY("user_id","template_id")
);
--> statement-breakpoint
ALTER TABLE "user_task_template_interactions" ADD CONSTRAINT "user_task_template_interactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
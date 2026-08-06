CREATE TABLE "agent_history_job_agents" (
	"job_id" text NOT NULL,
	"agent_id" text NOT NULL,
	CONSTRAINT "agent_history_job_agents_job_id_agent_id_pk" PRIMARY KEY("job_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "agent_history_job_topics" (
	"job_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"priority" boolean DEFAULT false NOT NULL,
	"activity_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_history_job_topics_job_id_topic_id_pk" PRIMARY KEY("job_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "agent_history_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"type" text DEFAULT 'transfer' NOT NULL,
	"agent_ids" jsonb NOT NULL,
	"session_ids" jsonb NOT NULL,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_user_id" text NOT NULL,
	"source_workspace_id" text,
	"target_user_id" text NOT NULL,
	"target_workspace_id" text,
	"total_topics" integer NOT NULL,
	"completed_topics" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_history_job_agents" ADD CONSTRAINT "agent_history_job_agents_job_id_agent_history_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_history_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_history_job_agents" ADD CONSTRAINT "agent_history_job_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_history_job_topics" ADD CONSTRAINT "agent_history_job_topics_job_id_agent_history_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_history_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_history_job_topics" ADD CONSTRAINT "agent_history_job_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_history_job_agents_agent_id_idx" ON "agent_history_job_agents" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_history_job_topics_topic_id_idx" ON "agent_history_job_topics" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "agent_history_job_topics_pick_idx" ON "agent_history_job_topics" USING btree ("job_id","priority","activity_at");--> statement-breakpoint
CREATE INDEX "agent_history_jobs_status_idx" ON "agent_history_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_history_jobs_source_user_id_idx" ON "agent_history_jobs" USING btree ("source_user_id");--> statement-breakpoint
CREATE INDEX "agent_history_jobs_target_user_id_idx" ON "agent_history_jobs" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "agent_history_jobs_source_workspace_id_idx" ON "agent_history_jobs" USING btree ("source_workspace_id");--> statement-breakpoint
CREATE INDEX "agent_history_jobs_target_workspace_id_idx" ON "agent_history_jobs" USING btree ("target_workspace_id");
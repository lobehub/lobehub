CREATE TABLE IF NOT EXISTS "expertise_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" varchar(255) NOT NULL,
	"agent_id" text,
	"project_id" text,
	"bound_workspace_id" text,
	"bound_user_id" text,
	"contribution_mode" text DEFAULT 'derive' NOT NULL,
	"added_by_user_id" text,
	"workspace_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expertise_bindings_exactly_one_carrier" CHECK (("expertise_bindings"."agent_id" IS NOT NULL)::int + ("expertise_bindings"."project_id" IS NOT NULL)::int + ("expertise_bindings"."bound_workspace_id" IS NOT NULL)::int + ("expertise_bindings"."bound_user_id" IS NOT NULL)::int = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expertise_domain_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" varchar(255) NOT NULL,
	"run_id" uuid,
	"run_index" integer NOT NULL,
	"learned_total" integer NOT NULL,
	"retired_total" integer DEFAULT 0 NOT NULL,
	"active_count" integer NOT NULL,
	"compiled_count" integer DEFAULT 0 NOT NULL,
	"layer_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"p_inf" numeric,
	"tau" numeric,
	"maturity" numeric,
	"fit_sample_size" integer,
	"fit_r2" numeric,
	"fit_confidence" text,
	"fit_computed_at" timestamp with time zone,
	"tau_pinned" boolean DEFAULT false NOT NULL,
	"observed_span" numeric,
	"plateau_kind" text,
	"layer_coverage" numeric,
	"canon_coverage" numeric,
	"active_rate" numeric,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expertise_domains" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"slug" varchar(255) NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"parent_domain_id" varchar(255),
	"domain_filter" text NOT NULL,
	"out_of_scope" text,
	"layers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"layer_source" text DEFAULT 'invented' NOT NULL,
	"canon_entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"canon_document_id" varchar(255),
	"flow" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_spec" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lesson_base_document_id" varchar(255),
	"anchor_candidates" jsonb,
	"anchor_chosen_at" timestamp with time zone,
	"anchor_chosen_by_user_id" text,
	"seed_state" text DEFAULT 'seeding' NOT NULL,
	"seed_run_id" uuid,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expertise_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"domain_id" varchar(255) NOT NULL,
	"outcome" text NOT NULL,
	"where" text,
	"note" text,
	"example" text,
	"severity" text,
	"evidence_id" uuid,
	"operation_id" text,
	"user_decision" text,
	"user_decision_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expertise_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" varchar(255),
	"user_id" text,
	"workspace_id" text,
	"kind" varchar(255) NOT NULL,
	"headline" text NOT NULL,
	"body" text NOT NULL,
	"action_label" text,
	"action_target" jsonb,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real,
	"status" text DEFAULT 'active' NOT NULL,
	"dismiss_reason" text,
	"stale_after_run_index" integer,
	"generated_by_operation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expertise_lesson_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"sections" jsonb NOT NULL,
	"feedback" text,
	"changed_by" text NOT NULL,
	"kind" text DEFAULT 'user-feedback' NOT NULL,
	"prev_title" text,
	"changed_by_user_id" text,
	"source_run_id" uuid,
	"operation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expertise_lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" varchar(255) NOT NULL,
	"created_by_user_id" text,
	"code" varchar(20) NOT NULL,
	"polarity" text NOT NULL,
	"title" text NOT NULL,
	"sections" jsonb NOT NULL,
	"layer" varchar(255),
	"tags" text[],
	"canon_anchor" text,
	"origin_run_id" uuid,
	"origin_hit_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"rejected_reason" text,
	"salvaged_from_id" uuid,
	"retired_at" timestamp with time zone,
	"compilability" text DEFAULT 'compilable' NOT NULL,
	"compiled_criterion_id" uuid,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"hit_run_count" integer DEFAULT 0 NOT NULL,
	"false_positive_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"last_hit_run_id" uuid,
	"generalized_from_ids" jsonb,
	"specificity" text,
	"example_count" integer DEFAULT 0 NOT NULL,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expertise_lessons_id_domain_unique" UNIQUE("id","domain_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expertise_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" varchar(255) NOT NULL,
	"run_index" integer NOT NULL,
	"is_seed_run" boolean DEFAULT false NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"reflection_key" varchar(255),
	"had_human_in_loop" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"workspace_id" text,
	"instance_count" integer DEFAULT 0 NOT NULL,
	"refine_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expertise_runs_id_domain_unique" UNIQUE("id","domain_id")
);
--> statement-breakpoint
ALTER TABLE "expertise_bindings" DROP CONSTRAINT IF EXISTS "expertise_bindings_domain_id_expertise_domains_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_bindings" ADD CONSTRAINT "expertise_bindings_domain_id_expertise_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."expertise_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_bindings" DROP CONSTRAINT IF EXISTS "expertise_bindings_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_bindings" ADD CONSTRAINT "expertise_bindings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_bindings" DROP CONSTRAINT IF EXISTS "expertise_bindings_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_bindings" ADD CONSTRAINT "expertise_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_bindings" DROP CONSTRAINT IF EXISTS "expertise_bindings_bound_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_bindings" ADD CONSTRAINT "expertise_bindings_bound_workspace_id_workspaces_id_fk" FOREIGN KEY ("bound_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_bindings" DROP CONSTRAINT IF EXISTS "expertise_bindings_bound_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_bindings" ADD CONSTRAINT "expertise_bindings_bound_user_id_users_id_fk" FOREIGN KEY ("bound_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_bindings" DROP CONSTRAINT IF EXISTS "expertise_bindings_added_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_bindings" ADD CONSTRAINT "expertise_bindings_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_bindings" DROP CONSTRAINT IF EXISTS "expertise_bindings_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_bindings" ADD CONSTRAINT "expertise_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_domain_snapshots" DROP CONSTRAINT IF EXISTS "expertise_domain_snapshots_domain_id_expertise_domains_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_domain_snapshots" ADD CONSTRAINT "expertise_domain_snapshots_domain_id_expertise_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."expertise_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_domain_snapshots" DROP CONSTRAINT IF EXISTS "expertise_domain_snapshots_run_id_expertise_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_domain_snapshots" ADD CONSTRAINT "expertise_domain_snapshots_run_id_expertise_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."expertise_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_domain_snapshots" DROP CONSTRAINT IF EXISTS "expertise_domain_snapshots_run_domain_fk";
--> statement-breakpoint
ALTER TABLE "expertise_domain_snapshots" ADD CONSTRAINT "expertise_domain_snapshots_run_domain_fk" FOREIGN KEY ("run_id","domain_id") REFERENCES "public"."expertise_runs"("id","domain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_domains" DROP CONSTRAINT IF EXISTS "expertise_domains_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_domains" ADD CONSTRAINT "expertise_domains_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_domains" DROP CONSTRAINT IF EXISTS "expertise_domains_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_domains" ADD CONSTRAINT "expertise_domains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_domains" DROP CONSTRAINT IF EXISTS "expertise_domains_parent_domain_id_expertise_domains_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_domains" ADD CONSTRAINT "expertise_domains_parent_domain_id_expertise_domains_id_fk" FOREIGN KEY ("parent_domain_id") REFERENCES "public"."expertise_domains"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_domains" DROP CONSTRAINT IF EXISTS "expertise_domains_canon_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_domains" ADD CONSTRAINT "expertise_domains_canon_document_id_documents_id_fk" FOREIGN KEY ("canon_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_domains" DROP CONSTRAINT IF EXISTS "expertise_domains_lesson_base_document_id_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_domains" ADD CONSTRAINT "expertise_domains_lesson_base_document_id_documents_id_fk" FOREIGN KEY ("lesson_base_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_domains" DROP CONSTRAINT IF EXISTS "expertise_domains_anchor_chosen_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_domains" ADD CONSTRAINT "expertise_domains_anchor_chosen_by_user_id_users_id_fk" FOREIGN KEY ("anchor_chosen_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_hits" DROP CONSTRAINT IF EXISTS "expertise_hits_domain_id_expertise_domains_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_hits" ADD CONSTRAINT "expertise_hits_domain_id_expertise_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."expertise_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_hits" DROP CONSTRAINT IF EXISTS "expertise_hits_evidence_id_verify_evidence_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_hits" ADD CONSTRAINT "expertise_hits_evidence_id_verify_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."verify_evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_hits" DROP CONSTRAINT IF EXISTS "expertise_hits_operation_id_agent_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_hits" ADD CONSTRAINT "expertise_hits_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_hits" DROP CONSTRAINT IF EXISTS "expertise_hits_run_domain_fk";
--> statement-breakpoint
ALTER TABLE "expertise_hits" ADD CONSTRAINT "expertise_hits_run_domain_fk" FOREIGN KEY ("run_id","domain_id") REFERENCES "public"."expertise_runs"("id","domain_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_hits" DROP CONSTRAINT IF EXISTS "expertise_hits_lesson_domain_fk";
--> statement-breakpoint
ALTER TABLE "expertise_hits" ADD CONSTRAINT "expertise_hits_lesson_domain_fk" FOREIGN KEY ("lesson_id","domain_id") REFERENCES "public"."expertise_lessons"("id","domain_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_insights" DROP CONSTRAINT IF EXISTS "expertise_insights_domain_id_expertise_domains_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_insights" ADD CONSTRAINT "expertise_insights_domain_id_expertise_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."expertise_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_insights" DROP CONSTRAINT IF EXISTS "expertise_insights_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_insights" ADD CONSTRAINT "expertise_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_insights" DROP CONSTRAINT IF EXISTS "expertise_insights_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_insights" ADD CONSTRAINT "expertise_insights_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_insights" DROP CONSTRAINT IF EXISTS "expertise_insights_generated_by_operation_id_agent_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_insights" ADD CONSTRAINT "expertise_insights_generated_by_operation_id_agent_operations_id_fk" FOREIGN KEY ("generated_by_operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_lesson_revisions" DROP CONSTRAINT IF EXISTS "expertise_lesson_revisions_lesson_id_expertise_lessons_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_lesson_revisions" ADD CONSTRAINT "expertise_lesson_revisions_lesson_id_expertise_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."expertise_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_lesson_revisions" DROP CONSTRAINT IF EXISTS "expertise_lesson_revisions_changed_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_lesson_revisions" ADD CONSTRAINT "expertise_lesson_revisions_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_lesson_revisions" DROP CONSTRAINT IF EXISTS "expertise_lesson_revisions_operation_id_agent_operations_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_lesson_revisions" ADD CONSTRAINT "expertise_lesson_revisions_operation_id_agent_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."agent_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_lessons" DROP CONSTRAINT IF EXISTS "expertise_lessons_domain_id_expertise_domains_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_lessons" ADD CONSTRAINT "expertise_lessons_domain_id_expertise_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."expertise_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_lessons" DROP CONSTRAINT IF EXISTS "expertise_lessons_created_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_lessons" ADD CONSTRAINT "expertise_lessons_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_lessons" DROP CONSTRAINT IF EXISTS "expertise_lessons_salvaged_from_id_expertise_lessons_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_lessons" ADD CONSTRAINT "expertise_lessons_salvaged_from_id_expertise_lessons_id_fk" FOREIGN KEY ("salvaged_from_id") REFERENCES "public"."expertise_lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_lessons" DROP CONSTRAINT IF EXISTS "expertise_lessons_compiled_criterion_id_verify_criteria_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_lessons" ADD CONSTRAINT "expertise_lessons_compiled_criterion_id_verify_criteria_id_fk" FOREIGN KEY ("compiled_criterion_id") REFERENCES "public"."verify_criteria"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_runs" DROP CONSTRAINT IF EXISTS "expertise_runs_domain_id_expertise_domains_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_runs" ADD CONSTRAINT "expertise_runs_domain_id_expertise_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."expertise_domains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_runs" DROP CONSTRAINT IF EXISTS "expertise_runs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_runs" ADD CONSTRAINT "expertise_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expertise_runs" DROP CONSTRAINT IF EXISTS "expertise_runs_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "expertise_runs" ADD CONSTRAINT "expertise_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_bindings_agent_domain_unique" ON "expertise_bindings" USING btree ("agent_id","domain_id") WHERE "expertise_bindings"."agent_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_bindings_project_domain_unique" ON "expertise_bindings" USING btree ("project_id","domain_id") WHERE "expertise_bindings"."project_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_bindings_workspace_domain_unique" ON "expertise_bindings" USING btree ("bound_workspace_id","domain_id") WHERE "expertise_bindings"."bound_workspace_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_bindings_user_domain_unique" ON "expertise_bindings" USING btree ("bound_user_id","domain_id") WHERE "expertise_bindings"."bound_user_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_bindings_domain_idx" ON "expertise_bindings" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_bindings_workspace_id_idx" ON "expertise_bindings" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_domain_snapshots_domain_run_index_unique" ON "expertise_domain_snapshots" USING btree ("domain_id","run_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_domain_snapshots_domain_captured_idx" ON "expertise_domain_snapshots" USING btree ("domain_id","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_domain_snapshots_pending_fit_idx" ON "expertise_domain_snapshots" USING btree ("domain_id") WHERE "expertise_domain_snapshots"."fit_computed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_domains_slug_user_unique" ON "expertise_domains" USING btree ("slug","user_id") WHERE "expertise_domains"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_domains_slug_workspace_unique" ON "expertise_domains" USING btree ("workspace_id","slug") WHERE "expertise_domains"."workspace_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_domains_user_id_idx" ON "expertise_domains" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_domains_workspace_visibility_idx" ON "expertise_domains" USING btree ("workspace_id","visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_domains_parent_idx" ON "expertise_domains" USING btree ("parent_domain_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_hits_lesson_created_idx" ON "expertise_hits" USING btree ("lesson_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_hits_run_idx" ON "expertise_hits" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_hits_domain_outcome_idx" ON "expertise_hits" USING btree ("domain_id","outcome");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_hits_operation_idx" ON "expertise_hits" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_insights_domain_status_idx" ON "expertise_insights" USING btree ("domain_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_insights_user_status_idx" ON "expertise_insights" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_insights_workspace_idx" ON "expertise_insights" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_lesson_revisions_lesson_revision_unique" ON "expertise_lesson_revisions" USING btree ("lesson_id","revision");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_lesson_revisions_lesson_idx" ON "expertise_lesson_revisions" USING btree ("lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_lessons_domain_code_unique" ON "expertise_lessons" USING btree ("domain_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_lessons_domain_status_hits_idx" ON "expertise_lessons" USING btree ("domain_id","status","hit_count");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_lessons_domain_layer_idx" ON "expertise_lessons" USING btree ("domain_id","layer");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_lessons_compiled_criterion_idx" ON "expertise_lessons" USING btree ("compiled_criterion_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_runs_domain_run_index_unique" ON "expertise_runs" USING btree ("domain_id","run_index");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expertise_runs_domain_reflection_key_unique" ON "expertise_runs" USING btree ("domain_id","reflection_key") WHERE "expertise_runs"."reflection_key" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_runs_domain_started_idx" ON "expertise_runs" USING btree ("domain_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_runs_actor_idx" ON "expertise_runs" USING btree ("actor_type","actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expertise_runs_subject_idx" ON "expertise_runs" USING btree ("subject_type","subject_id");

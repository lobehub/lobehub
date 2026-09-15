CREATE TABLE IF NOT EXISTS "acceptance_flow_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"condition" text,
	"required" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acceptance_flow_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flow_id" uuid NOT NULL,
	"criterion_id" uuid,
	"sub_flow_id" uuid,
	"is_entry" boolean DEFAULT false NOT NULL,
	"overrides" jsonb,
	CONSTRAINT "acceptance_flow_nodes_target_check" CHECK (num_nonnulls("acceptance_flow_nodes"."criterion_id", "acceptance_flow_nodes"."sub_flow_id") = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acceptance_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"acceptance_id" uuid NOT NULL,
	"title" text NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verify_check_results" ADD COLUMN IF NOT EXISTS "source_criterion_id" uuid;--> statement-breakpoint
ALTER TABLE "verify_criteria" ADD COLUMN IF NOT EXISTS "definition" jsonb;--> statement-breakpoint
ALTER TABLE "verify_criteria" ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "verify_criteria" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "verify_runs" ADD COLUMN IF NOT EXISTS "flow_snapshots" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acceptance_flow_nodes_flow_id_unique" ON "acceptance_flow_nodes" USING btree ("flow_id","id");--> statement-breakpoint
ALTER TABLE "acceptance_flow_edges" DROP CONSTRAINT IF EXISTS "acceptance_flow_edges_flow_id_acceptance_flows_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_flow_edges" ADD CONSTRAINT "acceptance_flow_edges_flow_id_acceptance_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."acceptance_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_flow_edges" DROP CONSTRAINT IF EXISTS "acceptance_flow_edges_flow_id_source_node_id_acceptance_flow_nodes_flow_id_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_flow_edges" ADD CONSTRAINT "acceptance_flow_edges_flow_id_source_node_id_acceptance_flow_nodes_flow_id_id_fk" FOREIGN KEY ("flow_id","source_node_id") REFERENCES "public"."acceptance_flow_nodes"("flow_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_flow_edges" DROP CONSTRAINT IF EXISTS "acceptance_flow_edges_flow_id_target_node_id_acceptance_flow_nodes_flow_id_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_flow_edges" ADD CONSTRAINT "acceptance_flow_edges_flow_id_target_node_id_acceptance_flow_nodes_flow_id_id_fk" FOREIGN KEY ("flow_id","target_node_id") REFERENCES "public"."acceptance_flow_nodes"("flow_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_flow_nodes" DROP CONSTRAINT IF EXISTS "acceptance_flow_nodes_flow_id_acceptance_flows_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_flow_nodes" ADD CONSTRAINT "acceptance_flow_nodes_flow_id_acceptance_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."acceptance_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acceptance_flow_nodes" DROP CONSTRAINT IF EXISTS "acceptance_flow_nodes_criterion_id_verify_criteria_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_flow_nodes" ADD CONSTRAINT "acceptance_flow_nodes_criterion_id_verify_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."verify_criteria"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "acceptance_flow_nodes" DROP CONSTRAINT IF EXISTS "acceptance_flow_nodes_sub_flow_id_acceptance_flows_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_flow_nodes" ADD CONSTRAINT "acceptance_flow_nodes_sub_flow_id_acceptance_flows_id_fk" FOREIGN KEY ("sub_flow_id") REFERENCES "public"."acceptance_flows"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "acceptance_flows" DROP CONSTRAINT IF EXISTS "acceptance_flows_acceptance_id_acceptances_id_fk";
--> statement-breakpoint
ALTER TABLE "acceptance_flows" ADD CONSTRAINT "acceptance_flows_acceptance_id_acceptances_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."acceptances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_flow_edges_source_idx" ON "acceptance_flow_edges" USING btree ("flow_id","source_node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_flow_edges_target_idx" ON "acceptance_flow_edges" USING btree ("flow_id","target_node_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_flow_nodes_sub_flow_idx" ON "acceptance_flow_nodes" USING btree ("sub_flow_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acceptance_flow_nodes_entry_unique" ON "acceptance_flow_nodes" USING btree ("flow_id") WHERE "acceptance_flow_nodes"."is_entry" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_flow_nodes_criterion_idx" ON "acceptance_flow_nodes" USING btree ("criterion_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acceptance_flows_acceptance_idx" ON "acceptance_flows" USING btree ("acceptance_id");--> statement-breakpoint
ALTER TABLE "verify_check_results" DROP CONSTRAINT IF EXISTS "verify_check_results_source_criterion_id_verify_criteria_id_fk";
--> statement-breakpoint
ALTER TABLE "verify_check_results" ADD CONSTRAINT "verify_check_results_source_criterion_id_verify_criteria_id_fk" FOREIGN KEY ("source_criterion_id") REFERENCES "public"."verify_criteria"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verify_check_results_criterion_created_idx" ON "verify_check_results" USING btree ("source_criterion_id","created_at");
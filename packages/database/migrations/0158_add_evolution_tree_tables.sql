CREATE TABLE IF NOT EXISTS "evolution_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tree_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"parent_id" uuid,
	"seq" integer NOT NULL,
	"content" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"score" numeric(20, 6),
	"error" text,
	"visits" integer DEFAULT 0 NOT NULL,
	"operation_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evolution_trees" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"title" text NOT NULL,
	"objective" text NOT NULL,
	"scorer" jsonb NOT NULL,
	"config" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"operation_id" text,
	"metadata" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evolution_nodes" DROP CONSTRAINT IF EXISTS "evolution_nodes_tree_id_evolution_trees_id_fk";--> statement-breakpoint
ALTER TABLE "evolution_nodes" ADD CONSTRAINT "evolution_nodes_tree_id_evolution_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."evolution_trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolution_nodes" DROP CONSTRAINT IF EXISTS "evolution_nodes_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "evolution_nodes" ADD CONSTRAINT "evolution_nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolution_nodes" DROP CONSTRAINT IF EXISTS "evolution_nodes_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "evolution_nodes" ADD CONSTRAINT "evolution_nodes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolution_nodes" DROP CONSTRAINT IF EXISTS "evolution_nodes_parent_fk";--> statement-breakpoint
ALTER TABLE "evolution_nodes" ADD CONSTRAINT "evolution_nodes_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."evolution_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolution_trees" DROP CONSTRAINT IF EXISTS "evolution_trees_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "evolution_trees" ADD CONSTRAINT "evolution_trees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evolution_trees" DROP CONSTRAINT IF EXISTS "evolution_trees_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "evolution_trees" ADD CONSTRAINT "evolution_trees_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "evolution_nodes_tree_seq_unique" ON "evolution_nodes" USING btree ("tree_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evolution_nodes_tree_score_idx" ON "evolution_nodes" USING btree ("tree_id","score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evolution_nodes_tree_parent_idx" ON "evolution_nodes" USING btree ("tree_id","parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evolution_nodes_user_id_idx" ON "evolution_nodes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evolution_nodes_workspace_id_idx" ON "evolution_nodes" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evolution_trees_user_id_idx" ON "evolution_trees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evolution_trees_workspace_id_idx" ON "evolution_trees" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evolution_trees_subject_idx" ON "evolution_trees" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "evolution_trees_status_idx" ON "evolution_trees" USING btree ("status");
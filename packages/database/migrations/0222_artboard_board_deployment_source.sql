ALTER TABLE "artboard_boards" ADD COLUMN IF NOT EXISTS "source_deployment_id" text;--> statement-breakpoint
ALTER TABLE "artboard_boards" ADD COLUMN IF NOT EXISTS "source_deployment_release_id" text;--> statement-breakpoint
ALTER TABLE "artboard_boards" ADD COLUMN IF NOT EXISTS "source_deployment_revision" integer;--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_deployment_release_check";--> statement-breakpoint
ALTER TABLE "artboard_boards" ADD CONSTRAINT "artboard_boards_deployment_release_check" CHECK (num_nonnulls("artboard_boards"."source_deployment_id", "artboard_boards"."source_deployment_release_id", "artboard_boards"."source_deployment_revision") IN (0, 3));--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_single_source_check";--> statement-breakpoint
ALTER TABLE "artboard_boards" ADD CONSTRAINT "artboard_boards_single_source_check" CHECK (num_nonnulls("artboard_boards"."source_work_version_id", "artboard_boards"."source_file_id", "artboard_boards"."source_deployment_id") <= 1);--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_decision_no_source_check";--> statement-breakpoint
ALTER TABLE "artboard_boards" ADD CONSTRAINT "artboard_boards_decision_no_source_check" CHECK ("artboard_boards"."type" <> 'decision' OR num_nonnulls("artboard_boards"."source_work_version_id", "artboard_boards"."source_file_id", "artboard_boards"."source_path", "artboard_boards"."source_deployment_id") = 0);

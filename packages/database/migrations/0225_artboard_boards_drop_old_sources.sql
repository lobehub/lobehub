ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_single_source_check";--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_decision_no_source_check";--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_source_work_version_id_work_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP CONSTRAINT IF EXISTS "artboard_boards_source_file_id_files_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "artboard_boards_source_work_version_id_idx";--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP COLUMN IF EXISTS "source_work_version_id";--> statement-breakpoint
ALTER TABLE "artboard_boards" DROP COLUMN IF EXISTS "source_file_id";--> statement-breakpoint
ALTER TABLE "artboard_boards" ADD CONSTRAINT "artboard_boards_decision_no_source_check" CHECK ("artboard_boards"."type" <> 'decision' OR "artboard_boards"."source_path" IS NULL);
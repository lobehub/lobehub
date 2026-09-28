ALTER TABLE "expertise_hits" ADD COLUMN "source_check_result_id" uuid;--> statement-breakpoint
ALTER TABLE "expertise_lesson_revisions" ADD COLUMN "evidence" jsonb;--> statement-breakpoint
ALTER TABLE "expertise_lessons" ADD COLUMN "reason_kind" text;--> statement-breakpoint
ALTER TABLE "expertise_lessons" ADD COLUMN "reason_source" text;--> statement-breakpoint
ALTER TABLE "expertise_lessons" ADD COLUMN "backtest" jsonb;--> statement-breakpoint
ALTER TABLE "expertise_hits" ADD CONSTRAINT "expertise_hits_source_check_result_id_verify_check_results_id_fk" FOREIGN KEY ("source_check_result_id") REFERENCES "public"."verify_check_results"("id") ON DELETE set null ON UPDATE no action;
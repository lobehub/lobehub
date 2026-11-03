ALTER TABLE "api_keys" DROP COLUMN IF EXISTS "id";--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" DROP COLUMN IF EXISTS "id";--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" DROP COLUMN IF EXISTS "id";--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" DROP COLUMN IF EXISTS "id";--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" DROP COLUMN IF EXISTS "id";--> statement-breakpoint
ALTER TABLE "rbac_permissions" DROP COLUMN IF EXISTS "id";--> statement-breakpoint
ALTER TABLE "rbac_roles" DROP COLUMN IF EXISTS "id";

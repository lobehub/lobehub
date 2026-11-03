ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_id_unique";--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" DROP CONSTRAINT IF EXISTS "rag_eval_dataset_records_id_unique";--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" DROP CONSTRAINT IF EXISTS "rag_eval_datasets_id_unique";--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" DROP CONSTRAINT IF EXISTS "rag_eval_evaluations_id_unique";--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" DROP CONSTRAINT IF EXISTS "rag_eval_evaluation_records_id_unique";--> statement-breakpoint
ALTER TABLE "rbac_permissions" DROP CONSTRAINT IF EXISTS "rbac_permissions_id_unique";--> statement-breakpoint
ALTER TABLE "rbac_roles" DROP CONSTRAINT IF EXISTS "rbac_roles_id_unique";

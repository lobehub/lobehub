ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "id_nanoid" text;--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" ADD COLUMN IF NOT EXISTS "id_nanoid" text;--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" ADD COLUMN IF NOT EXISTS "id_nanoid" text;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" ADD COLUMN IF NOT EXISTS "id_nanoid" text;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ADD COLUMN IF NOT EXISTS "id_nanoid" text;--> statement-breakpoint
ALTER TABLE "rbac_permissions" ADD COLUMN IF NOT EXISTS "id_nanoid" text;--> statement-breakpoint
ALTER TABLE "rbac_roles" ADD COLUMN IF NOT EXISTS "id_nanoid" text;

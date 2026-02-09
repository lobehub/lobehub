UPDATE "api_keys" SET "id_nanoid" = "id"::text WHERE "id_nanoid" IS NULL;--> statement-breakpoint
UPDATE "rag_eval_dataset_records" SET "id_nanoid" = "id"::text WHERE "id_nanoid" IS NULL;--> statement-breakpoint
UPDATE "rag_eval_datasets" SET "id_nanoid" = "id"::text WHERE "id_nanoid" IS NULL;--> statement-breakpoint
UPDATE "rag_eval_evaluations" SET "id_nanoid" = "id"::text WHERE "id_nanoid" IS NULL;--> statement-breakpoint
UPDATE "rag_eval_evaluation_records" SET "id_nanoid" = "id"::text WHERE "id_nanoid" IS NULL;--> statement-breakpoint
UPDATE "rbac_permissions" SET "id_nanoid" = "id"::text WHERE "id_nanoid" IS NULL;--> statement-breakpoint
UPDATE "rbac_roles" SET "id_nanoid" = "id"::text WHERE "id_nanoid" IS NULL;

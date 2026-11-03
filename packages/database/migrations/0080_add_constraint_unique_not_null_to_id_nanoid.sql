-- Thanks to Slava Fomin II shared in StackOverflow
-- https://stackoverflow.com/questions/29075413/change-primary-key-in-postgresql-table
-- https://stackoverflow.com/a/29087291/19954520

ALTER TABLE "api_keys" ALTER COLUMN "id_nanoid" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "rag_eval_dataset_records" ALTER COLUMN "id_nanoid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" ALTER COLUMN "id_nanoid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" ALTER COLUMN "id_nanoid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ALTER COLUMN "id_nanoid" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "rbac_permissions" ALTER COLUMN "id_nanoid" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rbac_roles" ALTER COLUMN "id_nanoid" SET NOT NULL;--> statement-breakpoint

-- We cannot add DROP CONSTRAINT IF EXISTS & ADD CONSTRAINT here as dropping previously created constraints for temporary purpose
-- id_nanoid will cause performance issues.
-- If anything happens wrong during the migration, please check and drop the existing constraints manually before re-applying the migration.

ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_id_nanoid_unique" UNIQUE("id_nanoid");--> statement-breakpoint

ALTER TABLE "rag_eval_dataset_records" ADD CONSTRAINT "rag_eval_dataset_records_id_nanoid_unique" UNIQUE("id_nanoid");--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" ADD CONSTRAINT "rag_eval_datasets_id_nanoid_unique" UNIQUE("id_nanoid");--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" ADD CONSTRAINT "rag_eval_evaluations_id_nanoid_unique" UNIQUE("id_nanoid");--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ADD CONSTRAINT "rag_eval_evaluation_records_id_nanoid_unique" UNIQUE("id_nanoid");--> statement-breakpoint

ALTER TABLE "rbac_permissions" ADD CONSTRAINT "rbac_permissions_id_nanoid_unique" UNIQUE("id_nanoid");--> statement-breakpoint
ALTER TABLE "rbac_roles" ADD CONSTRAINT "rbac_roles_id_nanoid_unique" UNIQUE("id_nanoid");

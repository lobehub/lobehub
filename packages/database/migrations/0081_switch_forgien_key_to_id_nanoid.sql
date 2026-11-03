-- Thanks to Slava Fomin II shared in StackOverflow
-- https://stackoverflow.com/questions/29075413/change-primary-key-in-postgresql-table
-- https://stackoverflow.com/a/29087291/19954520

ALTER TABLE "rag_eval_dataset_records" DROP CONSTRAINT IF EXISTS "rag_eval_dataset_records_dataset_id_rag_eval_datasets_id_fk";
--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" DROP CONSTRAINT IF EXISTS "rag_eval_evaluations_dataset_id_rag_eval_datasets_id_fk";
--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" DROP CONSTRAINT IF EXISTS "rag_eval_evaluation_records_dataset_record_id_rag_eval_dataset_records_id_fk";
--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" DROP CONSTRAINT IF EXISTS "rag_eval_evaluation_records_evaluation_id_rag_eval_evaluations_id_fk";
--> statement-breakpoint

ALTER TABLE "rbac_role_permissions" DROP CONSTRAINT IF EXISTS "rbac_role_permissions_role_id_rbac_roles_id_fk";
--> statement-breakpoint
ALTER TABLE "rbac_role_permissions" DROP CONSTRAINT IF EXISTS "rbac_role_permissions_permission_id_rbac_permissions_id_fk";
--> statement-breakpoint
ALTER TABLE "rbac_user_roles" DROP CONSTRAINT IF EXISTS "rbac_user_roles_role_id_rbac_roles_id_fk";
--> statement-breakpoint

ALTER TABLE "rag_eval_dataset_records" ALTER COLUMN "dataset_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" ALTER COLUMN "dataset_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ALTER COLUMN "dataset_record_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ALTER COLUMN "evaluation_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "rbac_role_permissions" ALTER COLUMN "role_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "rbac_role_permissions" ALTER COLUMN "permission_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "rbac_user_roles" ALTER COLUMN "role_id" SET DATA TYPE text;--> statement-breakpoint

ALTER TABLE "rag_eval_dataset_records" ADD CONSTRAINT "rag_eval_dataset_records_dataset_id_rag_eval_datasets_id_nanoid_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."rag_eval_datasets"("id_nanoid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" ADD CONSTRAINT "rag_eval_evaluations_dataset_id_rag_eval_datasets_id_nanoid_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."rag_eval_datasets"("id_nanoid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ADD CONSTRAINT "rag_eval_evaluation_records_dataset_record_id_rag_eval_dataset_records_id_nanoid_fk" FOREIGN KEY ("dataset_record_id") REFERENCES "public"."rag_eval_dataset_records"("id_nanoid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ADD CONSTRAINT "rag_eval_evaluation_records_evaluation_id_rag_eval_evaluations_id_nanoid_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."rag_eval_evaluations"("id_nanoid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "rbac_role_permissions" ADD CONSTRAINT "rbac_role_permissions_role_id_rbac_roles_id_nanoid_fk" FOREIGN KEY ("role_id") REFERENCES "public"."rbac_roles"("id_nanoid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rbac_role_permissions" ADD CONSTRAINT "rbac_role_permissions_permission_id_rbac_permissions_id_nanoid_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."rbac_permissions"("id_nanoid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rbac_user_roles" ADD CONSTRAINT "rbac_user_roles_role_id_rbac_roles_id_nanoid_fk" FOREIGN KEY ("role_id") REFERENCES "public"."rbac_roles"("id_nanoid") ON DELETE cascade ON UPDATE no action;

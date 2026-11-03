-- Renaming
ALTER TABLE "api_keys" RENAME COLUMN "id_nanoid" TO "id";--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" RENAME COLUMN "id_nanoid" TO "id";--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" RENAME COLUMN "id_nanoid" TO "id";--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" RENAME COLUMN "id_nanoid" TO "id";--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" RENAME COLUMN "id_nanoid" TO "id";--> statement-breakpoint
ALTER TABLE "rbac_permissions" RENAME COLUMN "id_nanoid" TO "id";--> statement-breakpoint
ALTER TABLE "rbac_roles" RENAME COLUMN "id_nanoid" TO "id";--> statement-breakpoint

-- Adding foreign keys back
ALTER TABLE "rag_eval_dataset_records" DROP CONSTRAINT IF EXISTS "rag_eval_dataset_records_dataset_id_rag_eval_datasets_id_fk";--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" ADD CONSTRAINT "rag_eval_dataset_records_dataset_id_rag_eval_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."rag_eval_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" DROP CONSTRAINT IF EXISTS "rag_eval_evaluations_dataset_id_rag_eval_datasets_id_fk";--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" ADD CONSTRAINT "rag_eval_evaluations_dataset_id_rag_eval_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."rag_eval_datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" DROP CONSTRAINT IF EXISTS "rag_eval_evaluation_records_dataset_record_id_rag_eval_dataset_records_id_fk";--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ADD CONSTRAINT "rag_eval_evaluation_records_dataset_record_id_rag_eval_dataset_records_id_fk" FOREIGN KEY ("dataset_record_id") REFERENCES "public"."rag_eval_dataset_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" DROP CONSTRAINT IF EXISTS "rag_eval_evaluation_records_evaluation_id_rag_eval_evaluations_id_fk";--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ADD CONSTRAINT "rag_eval_evaluation_records_evaluation_id_rag_eval_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."rag_eval_evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rbac_role_permissions" DROP CONSTRAINT IF EXISTS "rbac_role_permissions_role_id_rbac_roles_id_fk";--> statement-breakpoint
ALTER TABLE "rbac_role_permissions" ADD CONSTRAINT "rbac_role_permissions_role_id_rbac_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."rbac_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rbac_role_permissions" DROP CONSTRAINT IF EXISTS "rbac_role_permissions_permission_id_rbac_permissions_id_fk";--> statement-breakpoint
ALTER TABLE "rbac_role_permissions" ADD CONSTRAINT "rbac_role_permissions_permission_id_rbac_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."rbac_permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rbac_user_roles" DROP CONSTRAINT IF EXISTS "rbac_user_roles_role_id_rbac_roles_id_fk";--> statement-breakpoint
ALTER TABLE "rbac_user_roles" ADD CONSTRAINT "rbac_user_roles_role_id_rbac_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."rbac_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_id_unique";--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_id_unique" UNIQUE("id");--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" DROP CONSTRAINT IF EXISTS "rag_eval_dataset_records_id_unique";--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" ADD CONSTRAINT "rag_eval_dataset_records_id_unique" UNIQUE("id");--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" DROP CONSTRAINT IF EXISTS "rag_eval_datasets_id_unique";--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" ADD CONSTRAINT "rag_eval_datasets_id_unique" UNIQUE("id");--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" DROP CONSTRAINT IF EXISTS "rag_eval_evaluations_id_unique";--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" ADD CONSTRAINT "rag_eval_evaluations_id_unique" UNIQUE("id");--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" DROP CONSTRAINT IF EXISTS "rag_eval_evaluation_records_id_unique";--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ADD CONSTRAINT "rag_eval_evaluation_records_id_unique" UNIQUE("id");--> statement-breakpoint
ALTER TABLE "rbac_permissions" DROP CONSTRAINT IF EXISTS "rbac_permissions_id_unique";--> statement-breakpoint
ALTER TABLE "rbac_permissions" ADD CONSTRAINT "rbac_permissions_id_unique" UNIQUE("id");--> statement-breakpoint
ALTER TABLE "rbac_roles" DROP CONSTRAINT IF EXISTS "rbac_roles_id_unique";--> statement-breakpoint
ALTER TABLE "rbac_roles" ADD CONSTRAINT "rbac_roles_id_unique" UNIQUE("id");--> statement-breakpoint

-- Unused foreign key drop
ALTER TABLE "rag_eval_dataset_records" DROP CONSTRAINT IF EXISTS "rag_eval_dataset_records_dataset_id_rag_eval_datasets_id_nanoid_fk";
--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" DROP CONSTRAINT IF EXISTS "rag_eval_evaluations_dataset_id_rag_eval_datasets_id_nanoid_fk";
--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" DROP CONSTRAINT IF EXISTS "rag_eval_evaluation_records_dataset_record_id_rag_eval_dataset_records_id_nanoid_fk";
--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" DROP CONSTRAINT IF EXISTS "rag_eval_evaluation_records_evaluation_id_rag_eval_evaluations_id_nanoid_fk";
--> statement-breakpoint
ALTER TABLE "rbac_role_permissions" DROP CONSTRAINT IF EXISTS "rbac_role_permissions_role_id_rbac_roles_id_nanoid_fk";
--> statement-breakpoint
ALTER TABLE "rbac_role_permissions" DROP CONSTRAINT IF EXISTS "rbac_role_permissions_permission_id_rbac_permissions_id_nanoid_fk";
--> statement-breakpoint
ALTER TABLE "rbac_user_roles" DROP CONSTRAINT IF EXISTS "rbac_user_roles_role_id_rbac_roles_id_nanoid_fk";

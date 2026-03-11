ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_pkey";--> statement-breakpoint
ALTER TABLE "api_keys" ADD PRIMARY KEY ("id_nanoid");--> statement-breakpoint

ALTER TABLE "rag_eval_dataset_records" DROP CONSTRAINT "rag_eval_dataset_records_pkey";--> statement-breakpoint
ALTER TABLE "rag_eval_dataset_records" ADD PRIMARY KEY ("id_nanoid");--> statement-breakpoint

ALTER TABLE "rag_eval_datasets" DROP CONSTRAINT "rag_eval_datasets_pkey";--> statement-breakpoint
ALTER TABLE "rag_eval_datasets" ADD PRIMARY KEY ("id_nanoid");--> statement-breakpoint

ALTER TABLE "rag_eval_evaluations" DROP CONSTRAINT "rag_eval_evaluations_pkey";--> statement-breakpoint
ALTER TABLE "rag_eval_evaluations" ADD PRIMARY KEY ("id_nanoid");--> statement-breakpoint

ALTER TABLE "rag_eval_evaluation_records" DROP CONSTRAINT "rag_eval_evaluation_records_pkey";--> statement-breakpoint
ALTER TABLE "rag_eval_evaluation_records" ADD PRIMARY KEY ("id_nanoid");--> statement-breakpoint

ALTER TABLE "rbac_permissions" DROP CONSTRAINT "rbac_permissions_pkey";--> statement-breakpoint
ALTER TABLE "rbac_permissions" ADD PRIMARY KEY ("id_nanoid");--> statement-breakpoint

ALTER TABLE "rbac_roles" DROP CONSTRAINT "rbac_roles_pkey";--> statement-breakpoint
ALTER TABLE "rbac_roles" ADD PRIMARY KEY ("id_nanoid");

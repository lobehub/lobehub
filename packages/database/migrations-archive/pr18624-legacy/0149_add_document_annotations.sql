CREATE TABLE "document_annotations" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"document_id" varchar(255) NOT NULL,
	"user_id" text NOT NULL,
	"author" jsonb,
	"kind" text DEFAULT 'comment' NOT NULL,
	"payload" jsonb,
	"quoted_text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"anchor_metadata" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_annotations_status_check" CHECK ("document_annotations"."status" IN ('active', 'resolved', 'orphaned', 'deleted')),
	CONSTRAINT "document_annotations_version_positive" CHECK ("document_annotations"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_annotations" ADD CONSTRAINT "document_annotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_annotations_document_id_id_unique" ON "document_annotations" USING btree ("document_id","id");--> statement-breakpoint
CREATE INDEX "document_annotations_document_id_created_at_id_idx" ON "document_annotations" USING btree ("document_id","created_at","id");--> statement-breakpoint
CREATE INDEX "document_annotations_document_id_status_idx" ON "document_annotations" USING btree ("document_id","status");--> statement-breakpoint
CREATE INDEX "document_annotations_user_id_idx" ON "document_annotations" USING btree ("user_id");
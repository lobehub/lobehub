CREATE TABLE "document_collaboration_states" (
	"document_id" varchar(255) PRIMARY KEY NOT NULL,
	"room_id" varchar(255) NOT NULL,
	"workspace_id" text,
	"user_id" text NOT NULL,
	"room_revision" integer DEFAULT 0 NOT NULL,
	"state_vector" text DEFAULT '' NOT NULL,
	"version_token" varchar(255) NOT NULL,
	"document_updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_collaboration_states" ADD CONSTRAINT "document_collaboration_states_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_collaboration_states" ADD CONSTRAINT "document_collaboration_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_collaboration_states" ADD CONSTRAINT "document_collaboration_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_collaboration_states_room_id_idx" ON "document_collaboration_states" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "document_collaboration_states_workspace_id_idx" ON "document_collaboration_states" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "document_collaboration_states_user_id_idx" ON "document_collaboration_states" USING btree ("user_id");

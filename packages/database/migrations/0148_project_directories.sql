CREATE TABLE "project_directories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"environment_type" text NOT NULL,
	"device_id" uuid,
	"working_directory" text NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_directories" ADD CONSTRAINT "project_directories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_directories" ADD CONSTRAINT "project_directories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_directories" ADD CONSTRAINT "project_directories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_directories" ADD CONSTRAINT "project_directories_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_directories_project_id_idx" ON "project_directories" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_directories_device_id_idx" ON "project_directories" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "project_directories_working_directory_idx" ON "project_directories" USING btree ("working_directory");--> statement-breakpoint
CREATE INDEX "project_directories_workspace_id_idx" ON "project_directories" USING btree ("workspace_id");
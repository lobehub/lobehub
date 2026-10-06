CREATE INDEX IF NOT EXISTS "agent_documents_deleted_by_user_id_idx" ON "agent_documents" USING btree ("deleted_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_label_assignments_user_id_idx" ON "agent_label_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_calibrations_user_id_idx" ON "agent_quota_calibrations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_snapshots_user_id_idx" ON "agent_quota_snapshots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_quota_usage_ledger_user_id_idx" ON "agent_quota_usage_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_node_decisions_resolved_by_user_id_idx" ON "goal_node_decisions" USING btree ("resolved_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goal_nodes_created_by_user_id_idx" ON "goal_nodes" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_permissions_user_id_idx" ON "resource_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_permissions_created_by_idx" ON "resource_permissions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trash_items_user_id_idx" ON "trash_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trash_items_deleted_by_user_id_idx" ON "trash_items" USING btree ("deleted_by_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invitations_inviter_id_idx" ON "workspace_invitations" USING btree ("inviter_id");

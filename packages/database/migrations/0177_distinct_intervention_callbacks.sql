CREATE UNIQUE INDEX IF NOT EXISTS "agent_interventions_operation_batch_tool_call_unique" ON "agent_interventions" USING btree ("operation_id","batch_id","tool_call_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "agent_interventions_operation_tool_call_unique";

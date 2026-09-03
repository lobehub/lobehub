-- A Goal Graph node that owns a task is now `task`, not `work`: the two were
-- always 1:1, and `work` still names the works/work_versions artifact registry.
--
-- The CHECK goes rather than moving to the new value. `bindTask` is the only
-- writer of `task_id` and its WHERE already requires the kind, so the
-- constraint was redundant with the write path while pinning the kind
-- vocabulary into DDL — an ALTER for every future kind. The unique index on
-- `task_id` stays: one task belonging to one node is an invariant no single
-- write can check for itself.
--
-- Drop before backfilling: the old constraint reads `kind = 'work'`, so
-- updating a row that owns a task would violate it on the way past.
ALTER TABLE "goal_nodes" DROP CONSTRAINT IF EXISTS "goal_nodes_task_requires_work_kind";--> statement-breakpoint
UPDATE "goal_nodes" SET "kind" = 'task' WHERE "kind" = 'work';

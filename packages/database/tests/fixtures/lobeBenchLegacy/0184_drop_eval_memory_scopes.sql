-- The eval Memory of an attempt no longer lives under a synthetic `users` row
-- (see 0185_eval_memories): drop the owner map, its cleanup trigger and the
-- storage-only users it created. Nothing here was ever a real account.
DROP TRIGGER IF EXISTS eval_memory_scope_delete_owner ON agent_eval_memory_scopes;--> statement-breakpoint
DROP FUNCTION IF EXISTS cleanup_eval_memory_owner();--> statement-breakpoint
DROP TABLE IF EXISTS "agent_eval_memory_scopes" CASCADE;--> statement-breakpoint
DELETE FROM users WHERE id LIKE 'eval-memory:%' AND banned = true AND ban_reason = 'eval-memory-storage-only';

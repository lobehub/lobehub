-- Custom SQL migration file, put your code below! --
-- bm25 indexes disabled: pg_search/bm25 deprecated on Neon free tier

DROP INDEX IF EXISTS agents_bm25_idx;--> statement-breakpoint
DROP INDEX IF EXISTS topics_bm25_idx;--> statement-breakpoint
DROP INDEX IF EXISTS files_bm25_idx;--> statement-breakpoint
DROP INDEX IF EXISTS knowledge_bases_bm25_idx;--> statement-breakpoint
DROP INDEX IF EXISTS user_memories_bm25_idx;--> statement-breakpoint
DROP INDEX IF EXISTS chat_groups_bm25_idx;--> statement-breakpoint
DROP INDEX IF EXISTS user_memories_contexts_bm25_idx;--> statement-breakpoint
DROP INDEX IF EXISTS user_memories_preferences_bm25_idx;--> statement-breakpoint
DROP INDEX IF EXISTS user_memories_activities_bm25_idx;--> statement-breakpoint
DROP INDEX IF EXISTS user_memories_identities_bm25_idx;--> statement-breakpoint
DROP INDEX IF EXISTS user_memories_experiences_bm25_idx;--> statement-breakpoint
DROP INDEX IF EXISTS user_memory_persona_documents_bm25_idx;--> statement-breakpoint
DROP INDEX IF EXISTS documents_bm25_idx;--> statement-breakpoint
DROP INDEX IF EXISTS messages_bm25_idx;

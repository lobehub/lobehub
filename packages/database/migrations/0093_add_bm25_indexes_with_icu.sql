-- Custom SQL migration file, put your code below! --
-- All tables include user_id (keyword tokenizer + fast) for filter pushdown into tantivy index scan.
-- Enum/filter fields (type, status, role, etc.) use keyword+fast for the same reason.
-- Large tables (documents, messages) are placed last to avoid blocking smaller index builds.

-- 1. agents: title, description, slug, tags(jsonb), system_role, user_id
DROP INDEX IF EXISTS agents_bm25_idx;--> statement-breakpoint
CREATE INDEX agents_bm25_idx ON agents
USING bm25 (id, title, description, slug, tags, system_role, user_id)
WITH (
  key_field = 'id',
  text_fields = '{
    "title":       {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "description": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "slug":        {"tokenizer": {"type": "icu"}},
    "system_role": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "user_id":     {"fast": true, "tokenizer": {"type": "keyword"}}
  }',
  json_fields = '{
    "tags": {"tokenizer": {"type": "icu"}}
  }'
);--> statement-breakpoint

-- 2. topics: title, content, description, user_id
DROP INDEX IF EXISTS topics_bm25_idx;--> statement-breakpoint
CREATE INDEX topics_bm25_idx ON topics
USING bm25 (id, title, content, description, user_id)
WITH (
  key_field = 'id',
  text_fields = '{
    "title":       {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "content":     {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "description": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "user_id":     {"fast": true, "tokenizer": {"type": "keyword"}}
  }'
);--> statement-breakpoint

-- 3. files: name, user_id, file_type
DROP INDEX IF EXISTS files_bm25_idx;--> statement-breakpoint
CREATE INDEX files_bm25_idx ON files
USING bm25 (id, name, user_id, file_type)
WITH (
  key_field = 'id',
  text_fields = '{
    "name":      {"tokenizer": {"type": "icu"}},
    "user_id":   {"fast": true, "tokenizer": {"type": "keyword"}},
    "file_type": {"fast": true, "tokenizer": {"type": "keyword"}}
  }'
);--> statement-breakpoint

-- 4. knowledge_bases: name, description, user_id
DROP INDEX IF EXISTS knowledge_bases_bm25_idx;--> statement-breakpoint
CREATE INDEX knowledge_bases_bm25_idx ON knowledge_bases
USING bm25 (id, name, description, user_id)
WITH (
  key_field = 'id',
  text_fields = '{
    "name":        {"tokenizer": {"type": "icu"}},
    "description": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "user_id":     {"fast": true, "tokenizer": {"type": "keyword"}}
  }'
);--> statement-breakpoint

-- 5. user_memories: title, summary, details, memory_layer, memory_category, status, user_id
DROP INDEX IF EXISTS user_memories_bm25_idx;--> statement-breakpoint
CREATE INDEX user_memories_bm25_idx ON user_memories
USING bm25 (id, title, summary, details, memory_layer, memory_category, status, user_id)
WITH (
  key_field = 'id',
  text_fields = '{
    "title":           {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "summary":         {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "details":         {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "memory_layer":    {"fast": true, "tokenizer": {"type": "keyword"}},
    "memory_category": {"fast": true, "tokenizer": {"type": "keyword"}},
    "status":          {"fast": true, "tokenizer": {"type": "keyword"}},
    "user_id":         {"fast": true, "tokenizer": {"type": "keyword"}}
  }'
);--> statement-breakpoint

-- 6. chat_groups: title, description, content, user_id
DROP INDEX IF EXISTS chat_groups_bm25_idx;--> statement-breakpoint
CREATE INDEX chat_groups_bm25_idx ON chat_groups
USING bm25 (id, title, description, content, user_id)
WITH (
  key_field = 'id',
  text_fields = '{
    "title":       {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "description": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "content":     {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "user_id":     {"fast": true, "tokenizer": {"type": "keyword"}}
  }'
);--> statement-breakpoint

-- 7. user_memories_contexts: title, description, current_status, type, user_id
DROP INDEX IF EXISTS user_memories_contexts_bm25_idx;--> statement-breakpoint
CREATE INDEX user_memories_contexts_bm25_idx ON user_memories_contexts
USING bm25 (id, title, description, current_status, type, user_id)
WITH (
  key_field = 'id',
  text_fields = '{
    "title":          {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "description":    {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "current_status": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "type":           {"fast": true, "tokenizer": {"type": "keyword"}},
    "user_id":        {"fast": true, "tokenizer": {"type": "keyword"}}
  }'
);--> statement-breakpoint

-- 8. user_memories_preferences: conclusion_directives, suggestions, type, user_id
DROP INDEX IF EXISTS user_memories_preferences_bm25_idx;--> statement-breakpoint
CREATE INDEX user_memories_preferences_bm25_idx ON user_memories_preferences
USING bm25 (id, conclusion_directives, suggestions, type, user_id)
WITH (
  key_field = 'id',
  text_fields = '{
    "conclusion_directives": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "suggestions":           {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "type":                  {"fast": true, "tokenizer": {"type": "keyword"}},
    "user_id":               {"fast": true, "tokenizer": {"type": "keyword"}}
  }'
);--> statement-breakpoint

-- 9. user_memories_activities: notes, narrative, feedback, type, status, user_id
DROP INDEX IF EXISTS user_memories_activities_bm25_idx;--> statement-breakpoint
CREATE INDEX user_memories_activities_bm25_idx ON user_memories_activities
USING bm25 (id, notes, narrative, feedback, type, status, user_id)
WITH (
  key_field = 'id',
  text_fields = '{
    "notes":     {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "narrative": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "feedback":  {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "type":      {"fast": true, "tokenizer": {"type": "keyword"}},
    "status":    {"fast": true, "tokenizer": {"type": "keyword"}},
    "user_id":   {"fast": true, "tokenizer": {"type": "keyword"}}
  }'
);--> statement-breakpoint

-- 10. user_memories_identities: description, role, type, relationship, user_id
DROP INDEX IF EXISTS user_memories_identities_bm25_idx;--> statement-breakpoint
CREATE INDEX user_memories_identities_bm25_idx ON user_memories_identities
USING bm25 (id, description, role, type, relationship, user_id)
WITH (
  key_field = 'id',
  text_fields = '{
    "description":  {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "role":         {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "type":         {"fast": true, "tokenizer": {"type": "keyword"}},
    "relationship": {"fast": true, "tokenizer": {"type": "keyword"}},
    "user_id":      {"fast": true, "tokenizer": {"type": "keyword"}}
  }'
);--> statement-breakpoint

-- 11. user_memories_experiences: situation, reasoning, possible_outcome, action, key_learning, type, user_id
DROP INDEX IF EXISTS user_memories_experiences_bm25_idx;--> statement-breakpoint
CREATE INDEX user_memories_experiences_bm25_idx ON user_memories_experiences
USING bm25 (id, situation, reasoning, possible_outcome, action, key_learning, type, user_id)
WITH (
  key_field = 'id',
  text_fields = '{
    "situation":        {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "reasoning":        {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "possible_outcome": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "action":           {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "key_learning":     {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "type":             {"fast": true, "tokenizer": {"type": "keyword"}},
    "user_id":          {"fast": true, "tokenizer": {"type": "keyword"}}
  }'
);--> statement-breakpoint

-- 12. user_memory_persona_documents: tagline, persona, user_id
DROP INDEX IF EXISTS user_memory_persona_documents_bm25_idx;--> statement-breakpoint
CREATE INDEX user_memory_persona_documents_bm25_idx ON user_memory_persona_documents
USING bm25 (id, tagline, persona, user_id)
WITH (
  key_field = 'id',
  text_fields = '{
    "tagline": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "persona": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "user_id": {"fast": true, "tokenizer": {"type": "keyword"}}
  }'
);--> statement-breakpoint

-- 13. documents (large table): title, description, content, slug, user_id, file_type, source_type
DROP INDEX IF EXISTS documents_bm25_idx;--> statement-breakpoint
CREATE INDEX documents_bm25_idx ON documents
USING bm25 (id, title, description, content, slug, user_id, file_type, source_type)
WITH (
  key_field = 'id',
  text_fields = '{
    "title":       {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "description": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "content":     {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "slug":        {"tokenizer": {"type": "icu"}},
    "user_id":     {"fast": true, "tokenizer": {"type": "keyword"}},
    "file_type":   {"fast": true, "tokenizer": {"type": "keyword"}},
    "source_type": {"fast": true, "tokenizer": {"type": "keyword"}}
  }'
);--> statement-breakpoint

-- 14. messages (largest table): content, summary, user_id, role
DROP INDEX IF EXISTS messages_bm25_idx;--> statement-breakpoint
CREATE INDEX messages_bm25_idx ON messages
USING bm25 (id, content, summary, user_id, role)
WITH (
  key_field = 'id',
  text_fields = '{
    "content": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "summary": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
    "user_id": {"fast": true, "tokenizer": {"type": "keyword"}},
    "role":    {"fast": true, "tokenizer": {"type": "keyword"}}
  }'
);

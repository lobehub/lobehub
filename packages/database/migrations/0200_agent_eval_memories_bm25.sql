-- Custom SQL migration file, put your code below! --
-- The attempt Memory's lexical index. An eval attempt's Memory tool runs the account
-- Memory's search over `agent_eval_memories`: the same paradedb.match conjunction, with
-- the same tokenizer as 0093, over the headline columns and the layer fields that live
-- inside `payload`. Created only when pg_search is installed, like every BM25 index.
DROP INDEX IF EXISTS agent_eval_memories_bm25_idx;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_search') THEN
    EXECUTE $bm25$
      CREATE INDEX agent_eval_memories_bm25_idx ON agent_eval_memories
      USING bm25 (id, title, summary, details, payload, layer, user_id, attempt_id)
      WITH (
        key_field = 'id',
        text_fields = '{
          "title":      {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
          "summary":    {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
          "details":    {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}},
          "layer":      {"fast": true, "tokenizer": {"type": "keyword"}},
          "user_id":    {"fast": true, "tokenizer": {"type": "keyword"}},
          "attempt_id": {"fast": true, "tokenizer": {"type": "keyword"}}
        }',
        json_fields = '{
          "payload": {"tokenizer": {"type": "icu", "stemmer": "English", "stopwords_language": "English"}}
        }'
      )
    $bm25$;
  END IF;
END $$;

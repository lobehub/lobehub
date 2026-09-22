import type { Client, QueryResultRow } from 'pg';

export const PG_SEARCH_BM25_INDEXES = [
  { name: 'agents_bm25_idx', table: 'agents' },
  { name: 'chat_groups_bm25_idx', table: 'chat_groups' },
  { name: 'documents_bm25_idx', table: 'documents' },
  { name: 'files_bm25_idx', table: 'files' },
  { name: 'knowledge_bases_bm25_idx', table: 'knowledge_bases' },
  { name: 'messages_bm25_idx', table: 'messages' },
  { name: 'topics_bm25_idx', table: 'topics' },
  { name: 'user_memories_activities_bm25_idx', table: 'user_memories_activities' },
  { name: 'user_memories_bm25_idx', table: 'user_memories' },
  { name: 'user_memories_contexts_bm25_idx', table: 'user_memories_contexts' },
  { name: 'user_memories_experiences_bm25_idx', table: 'user_memories_experiences' },
  { name: 'user_memories_identities_bm25_idx', table: 'user_memories_identities' },
  { name: 'user_memories_preferences_bm25_idx', table: 'user_memories_preferences' },
  {
    name: 'user_memory_persona_documents_bm25_idx',
    table: 'user_memory_persona_documents',
  },
] as const;

export interface PgSearchBm25Index {
  name: string;
  schema: string;
  table: string;
  valid: boolean;
}

export interface PgSearchInventory {
  bm25Indexes: PgSearchBm25Index[];
  extensionVersion: null | string;
}

interface ExtensionRow extends QueryResultRow {
  extversion: string;
}

interface IndexRow extends QueryResultRow {
  index_name: string;
  is_valid: boolean;
  schema_name: string;
  table_name: string;
}

export const readPgSearchInventory = async (client: Client): Promise<PgSearchInventory> => {
  const [extension, indexes] = await Promise.all([
    client.query<ExtensionRow>(`SELECT extversion FROM pg_extension WHERE extname = 'pg_search'`),
    client.query<IndexRow>(`
      SELECT
        index_namespace.nspname AS schema_name,
        index_relation.relname AS index_name,
        table_relation.relname AS table_name,
        index_record.indisvalid AS is_valid
      FROM pg_index AS index_record
      JOIN pg_class AS index_relation ON index_relation.oid = index_record.indexrelid
      JOIN pg_namespace AS index_namespace ON index_namespace.oid = index_relation.relnamespace
      JOIN pg_class AS table_relation ON table_relation.oid = index_record.indrelid
      JOIN pg_am AS access_method ON access_method.oid = index_relation.relam
      WHERE access_method.amname = 'bm25'
      ORDER BY index_namespace.nspname, index_relation.relname
    `),
  ]);

  return {
    bm25Indexes: indexes.rows.map((row) => ({
      name: row.index_name,
      schema: row.schema_name,
      table: row.table_name,
      valid: row.is_valid,
    })),
    extensionVersion: extension.rows[0]?.extversion ?? null,
  };
};

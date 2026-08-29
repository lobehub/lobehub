import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

interface CaptureTriggerDefinition {
  createSql: string;
  name: string;
  table: string;
}

const CAPTURE_TRIGGER_DEFINITIONS: CaptureTriggerDefinition[] = [
  {
    createSql: `CREATE TRIGGER search_sync_agents
      AFTER INSERT OR DELETE OR UPDATE OF description, slug, system_role, tags, title, user_id, virtual, visibility, workspace_id ON agents
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_change(
        'agents', 'user_id', 'visibility', 'workspace_id'
      )`,
    name: 'search_sync_agents',
    table: 'agents',
  },
  {
    createSql: `CREATE TRIGGER search_sync_topics
      AFTER INSERT OR DELETE OR UPDATE OF agent_id, content, description, group_id, session_id, status, title, user_id, workspace_id ON topics
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_change(
        'topics', 'user_id', 'workspace_id'
      )`,
    name: 'search_sync_topics',
    table: 'topics',
  },
  {
    createSql: `CREATE TRIGGER search_sync_files
      AFTER INSERT OR DELETE OR UPDATE OF file_type, name, size, source, user_id, visibility, workspace_id ON files
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_change(
        'files', 'user_id', 'visibility', 'workspace_id'
      )`,
    name: 'search_sync_files',
    table: 'files',
  },
  {
    createSql: `CREATE TRIGGER search_sync_knowledge_bases
      AFTER INSERT OR DELETE OR UPDATE OF description, is_public, name, type, user_id, visibility, workspace_id ON knowledge_bases
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_change(
        'knowledgeBases', 'is_public', 'user_id', 'visibility', 'workspace_id'
      )`,
    name: 'search_sync_knowledge_bases',
    table: 'knowledge_bases',
  },
  {
    createSql: `CREATE TRIGGER search_sync_chat_groups
      AFTER INSERT OR DELETE OR UPDATE OF content, description, group_id, title, user_id, visibility, workspace_id ON chat_groups
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_change(
        'chatGroups', 'user_id', 'visibility', 'workspace_id'
      )`,
    name: 'search_sync_chat_groups',
    table: 'chat_groups',
  },
  {
    createSql: `CREATE TRIGGER search_sync_documents
      AFTER INSERT OR DELETE OR UPDATE OF content, description, file_id, file_type, knowledge_base_id, parent_id, slug, source_type, title, total_char_count, user_id, visibility, workspace_id ON documents
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_change(
        'documents', 'user_id', 'visibility', 'workspace_id'
      )`,
    name: 'search_sync_documents',
    table: 'documents',
  },
  {
    createSql: `CREATE TRIGGER search_sync_messages
      AFTER INSERT OR DELETE OR UPDATE OF agent_id, content, group_id, role, session_id, summary, thread_id, topic_id, user_id, workspace_id ON messages
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_change(
        'messages', 'user_id', 'workspace_id'
      )`,
    name: 'search_sync_messages',
    table: 'messages',
  },
  {
    createSql: `CREATE TRIGGER search_sync_user_memories
      AFTER INSERT OR DELETE OR UPDATE OF captured_at, details, memory_category, memory_layer, status, summary, tags, title, user_id ON user_memories
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_change(
        'userMemories', 'user_id'
      )`,
    name: 'search_sync_user_memories',
    table: 'user_memories',
  },
  {
    createSql: `CREATE TRIGGER search_sync_user_memories_fanout
      AFTER INSERT OR DELETE OR UPDATE OF captured_at, details, memory_category, memory_layer, status, summary, tags, title, user_id ON user_memories
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_memory_fanout()`,
    name: 'search_sync_user_memories_fanout',
    table: 'user_memories',
  },
  {
    createSql: `CREATE TRIGGER search_sync_memory_contexts
      AFTER INSERT OR DELETE OR UPDATE OF captured_at, current_status, description, tags, title, type, user_id, user_memory_ids ON user_memories_contexts
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_change(
        'memoryContexts', 'user_id'
      )`,
    name: 'search_sync_memory_contexts',
    table: 'user_memories_contexts',
  },
  {
    createSql: `CREATE TRIGGER search_sync_memory_preferences
      AFTER INSERT OR DELETE OR UPDATE OF captured_at, conclusion_directives, suggestions, tags, type, user_id, user_memory_id ON user_memories_preferences
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_change(
        'memoryPreferences', 'user_id'
      )`,
    name: 'search_sync_memory_preferences',
    table: 'user_memories_preferences',
  },
  {
    createSql: `CREATE TRIGGER search_sync_memory_activities
      AFTER INSERT OR DELETE OR UPDATE OF captured_at, ends_at, feedback, narrative, notes, starts_at, status, tags, type, user_id, user_memory_id ON user_memories_activities
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_change(
        'memoryActivities', 'user_id'
      )`,
    name: 'search_sync_memory_activities',
    table: 'user_memories_activities',
  },
  {
    createSql: `CREATE TRIGGER search_sync_memory_identities
      AFTER INSERT OR DELETE OR UPDATE OF captured_at, description, episodic_date, relationship, role, tags, type, user_id, user_memory_id ON user_memories_identities
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_change(
        'memoryIdentities', 'user_id'
      )`,
    name: 'search_sync_memory_identities',
    table: 'user_memories_identities',
  },
  {
    createSql: `CREATE TRIGGER search_sync_memory_experiences
      AFTER INSERT OR DELETE OR UPDATE OF action, captured_at, key_learning, possible_outcome, reasoning, situation, tags, type, user_id, user_memory_id ON user_memories_experiences
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_change(
        'memoryExperiences', 'user_id'
      )`,
    name: 'search_sync_memory_experiences',
    table: 'user_memories_experiences',
  },
  {
    createSql: `CREATE TRIGGER search_sync_persona_documents
      AFTER INSERT OR DELETE OR UPDATE OF captured_at, persona, profile, tagline, user_id, version ON user_memory_persona_documents
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_change(
        'personaDocuments', 'user_id'
      )`,
    name: 'search_sync_persona_documents',
    table: 'user_memory_persona_documents',
  },
  {
    createSql: `CREATE TRIGGER search_sync_knowledge_base_files
      AFTER INSERT OR DELETE OR UPDATE OF file_id, knowledge_base_id ON knowledge_base_files
      FOR EACH ROW EXECUTE FUNCTION capture_search_sync_knowledge_base_files()`,
    name: 'search_sync_knowledge_base_files',
    table: 'knowledge_base_files',
  },
];

const createCaptureTriggerStatement = ({ createSql, name, table }: CaptureTriggerDefinition): SQL =>
  sql.raw(`
  DO $search_sync_trigger$
  BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = '${name}' AND tgrelid = 'public.${table}'::regclass
    ) THEN
      BEGIN
        ${createSql};
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END;
    END IF;
  END;
  $search_sync_trigger$ LANGUAGE plpgsql
`);

export const SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS = CAPTURE_TRIGGER_DEFINITIONS.map(
  ({ name, table }) => ({ name, table }),
);

export const SEARCH_SYNC_CAPTURE_TRIGGER_STATEMENTS = CAPTURE_TRIGGER_DEFINITIONS.map(
  createCaptureTriggerStatement,
);

export const SEARCH_SYNC_MEMORY_CONTEXTS_GIN_INDEX =
  'user_memories_contexts_user_memory_ids_gin_idx';

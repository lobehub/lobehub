import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

interface CaptureFunctionDefinition {
  body: string;
  identityArguments: string;
  name: string;
  result: 'trigger' | 'void';
  signature: string;
}

interface CaptureTriggerDefinition {
  createSql: string;
  name: string;
  table: string;
}

export const FTS_SEARCH_SYNC_MEMORY_CONTEXTS_GIN_INDEX =
  'user_memories_contexts_user_memory_ids_gin_idx';

const ENQUEUE_FTS_SEARCH_SYNC_OUTBOX_BODY = `
    BEGIN
      INSERT INTO fts_search_sync_outbox (entity, document_id, priority)
      SELECT DISTINCT p_entity, document_id, p_priority
      FROM unnest(p_document_ids) AS document_id
      WHERE document_id IS NOT NULL AND document_id <> ''
      ORDER BY document_id
      ON CONFLICT (entity, document_id) DO UPDATE SET
        attempts = 0,
        available_at = now(),
        dead_at = NULL,
        last_error = NULL,
        locked_until = NULL,
        priority = LEAST(fts_search_sync_outbox.priority, EXCLUDED.priority),
        -- Allocate after locking the conflicting row so concurrent upserts preserve commit order.
        revision = nextval('fts_search_sync_revision_seq'),
        updated_at = now();
    END;
`;

const CAPTURE_FTS_SEARCH_SYNC_CHANGE_BODY = `
    DECLARE
      field_name text;
      old_row jsonb;
      new_row jsonb;
      priority smallint := CASE WHEN TG_OP = 'DELETE' THEN 0 ELSE 10 END;
      row_id text;
    BEGIN
      IF TG_OP = 'UPDATE' AND TG_NARGS > 1 THEN
        old_row := to_jsonb(OLD);
        new_row := to_jsonb(NEW);
        FOREACH field_name IN ARRAY TG_ARGV[1:TG_NARGS - 1] LOOP
          IF old_row->field_name IS DISTINCT FROM new_row->field_name THEN
            priority := 0;
          END IF;
        END LOOP;
      END IF;

      IF TG_OP = 'DELETE' THEN
        row_id := OLD.id::text;
      ELSE
        row_id := NEW.id::text;
      END IF;

      PERFORM enqueue_fts_search_sync_outbox(TG_ARGV[0], ARRAY[row_id], priority);
      RETURN COALESCE(NEW, OLD);
    END;
`;

const CAPTURE_FTS_SEARCH_SYNC_MEMORY_FANOUT_BODY = `
    -- Keep this fanout aligned with FtsSearchDocumentBuilder.resolveAffectedKeys.
    DECLARE
      memory_id text := COALESCE(NEW.id, OLD.id)::text;
      priority smallint := CASE WHEN TG_OP = 'DELETE' THEN 0 ELSE 10 END;
    BEGIN
      PERFORM enqueue_fts_search_sync_outbox(
        'memoryContexts',
        ARRAY(SELECT id::text FROM user_memories_contexts WHERE user_memory_ids @> to_jsonb(ARRAY[memory_id]) ORDER BY id),
        priority
      );
      PERFORM enqueue_fts_search_sync_outbox(
        'memoryPreferences',
        ARRAY(SELECT id::text FROM user_memories_preferences WHERE user_memory_id = memory_id ORDER BY id),
        priority
      );
      PERFORM enqueue_fts_search_sync_outbox(
        'memoryActivities',
        ARRAY(SELECT id::text FROM user_memories_activities WHERE user_memory_id = memory_id ORDER BY id),
        priority
      );
      PERFORM enqueue_fts_search_sync_outbox(
        'memoryIdentities',
        ARRAY(SELECT id::text FROM user_memories_identities WHERE user_memory_id = memory_id ORDER BY id),
        priority
      );
      PERFORM enqueue_fts_search_sync_outbox(
        'memoryExperiences',
        ARRAY(SELECT id::text FROM user_memories_experiences WHERE user_memory_id = memory_id ORDER BY id),
        priority
      );

      RETURN COALESCE(NEW, OLD);
    END;
`;

const CAPTURE_FTS_SEARCH_SYNC_KNOWLEDGE_BASE_FILES_BODY = `
    -- Keep this fanout aligned with FtsSearchDocumentBuilder.resolveAffectedKeys.
    DECLARE
      file_ids text[] := ARRAY[
        CASE WHEN TG_OP <> 'INSERT' THEN OLD.file_id::text END,
        CASE WHEN TG_OP <> 'DELETE' THEN NEW.file_id::text END
      ];
    BEGIN
      PERFORM enqueue_fts_search_sync_outbox('files', file_ids, 0::smallint);
      PERFORM enqueue_fts_search_sync_outbox(
        'documents',
        ARRAY(SELECT id::text FROM documents WHERE file_id = ANY(file_ids) ORDER BY id),
        0::smallint
      );
      RETURN COALESCE(NEW, OLD);
    END;
`;

const CAPTURE_FUNCTION_DEFINITIONS: CaptureFunctionDefinition[] = [
  {
    body: ENQUEUE_FTS_SEARCH_SYNC_OUTBOX_BODY,
    identityArguments: 'p_entity text, p_document_ids text[], p_priority smallint',
    name: 'enqueue_fts_search_sync_outbox',
    result: 'void',
    signature: `
      p_entity text,
      p_document_ids text[],
      p_priority smallint DEFAULT 10
    `,
  },
  {
    body: CAPTURE_FTS_SEARCH_SYNC_CHANGE_BODY,
    identityArguments: '',
    name: 'capture_fts_search_sync_change',
    result: 'trigger',
    signature: '',
  },
  {
    body: CAPTURE_FTS_SEARCH_SYNC_MEMORY_FANOUT_BODY,
    identityArguments: '',
    name: 'capture_fts_search_sync_memory_fanout',
    result: 'trigger',
    signature: '',
  },
  {
    body: CAPTURE_FTS_SEARCH_SYNC_KNOWLEDGE_BASE_FILES_BODY,
    identityArguments: '',
    name: 'capture_fts_search_sync_knowledge_base_files',
    result: 'trigger',
    signature: '',
  },
];

const createCaptureFunctionStatement = ({
  body,
  name,
  result,
  signature,
}: CaptureFunctionDefinition) =>
  sql.raw(`
    CREATE OR REPLACE FUNCTION ${name}(${signature}) RETURNS ${result} AS $fts_search_sync_capture$
${body}
    $fts_search_sync_capture$ LANGUAGE plpgsql
  `);

export const FTS_SEARCH_SYNC_CAPTURE_FUNCTION_STATEMENTS = CAPTURE_FUNCTION_DEFINITIONS.map(
  createCaptureFunctionStatement,
);

export const FTS_SEARCH_SYNC_CAPTURE_FUNCTION_TARGETS = CAPTURE_FUNCTION_DEFINITIONS.map(
  ({ body, identityArguments, name, result }) => ({
    body: body.trim(),
    identityArguments,
    name,
    result,
  }),
);

const CAPTURE_TRIGGER_DEFINITIONS: CaptureTriggerDefinition[] = [
  {
    createSql: `CREATE TRIGGER fts_search_sync_agents
      AFTER INSERT OR DELETE OR UPDATE OF description, slug, system_role, tags, title, updated_at, user_id, virtual, visibility, workspace_id ON public.agents
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change(
        'agents', 'user_id', 'visibility', 'workspace_id'
      )`,
    name: 'fts_search_sync_agents',
    table: 'agents',
  },
  {
    createSql: `CREATE TRIGGER fts_search_sync_topics
      AFTER INSERT OR DELETE OR UPDATE OF agent_id, content, description, group_id, session_id, status, title, updated_at, user_id, workspace_id ON public.topics
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change(
        'topics', 'user_id', 'workspace_id'
      )`,
    name: 'fts_search_sync_topics',
    table: 'topics',
  },
  {
    createSql: `CREATE TRIGGER fts_search_sync_files
      AFTER INSERT OR DELETE OR UPDATE OF file_type, name, size, source, updated_at, user_id, visibility, workspace_id ON public.files
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change(
        'files', 'user_id', 'visibility', 'workspace_id'
      )`,
    name: 'fts_search_sync_files',
    table: 'files',
  },
  {
    createSql: `CREATE TRIGGER fts_search_sync_knowledge_bases
      AFTER INSERT OR DELETE OR UPDATE OF description, is_public, name, type, updated_at, user_id, visibility, workspace_id ON public.knowledge_bases
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change(
        'knowledgeBases', 'is_public', 'user_id', 'visibility', 'workspace_id'
      )`,
    name: 'fts_search_sync_knowledge_bases',
    table: 'knowledge_bases',
  },
  {
    createSql: `CREATE TRIGGER fts_search_sync_chat_groups
      AFTER INSERT OR DELETE OR UPDATE OF content, description, group_id, title, updated_at, user_id, visibility, workspace_id ON public.chat_groups
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change(
        'chatGroups', 'user_id', 'visibility', 'workspace_id'
      )`,
    name: 'fts_search_sync_chat_groups',
    table: 'chat_groups',
  },
  {
    createSql: `CREATE TRIGGER fts_search_sync_documents
      AFTER INSERT OR DELETE OR UPDATE OF content, description, file_id, file_type, knowledge_base_id, parent_id, slug, source_type, title, total_char_count, updated_at, user_id, visibility, workspace_id ON public.documents
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change(
        'documents', 'user_id', 'visibility', 'workspace_id'
      )`,
    name: 'fts_search_sync_documents',
    table: 'documents',
  },
  {
    createSql: `CREATE TRIGGER fts_search_sync_messages
      AFTER INSERT OR DELETE OR UPDATE OF agent_id, content, group_id, role, session_id, summary, thread_id, topic_id, updated_at, user_id, workspace_id ON public.messages
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change(
        'messages', 'user_id', 'workspace_id'
      )`,
    name: 'fts_search_sync_messages',
    table: 'messages',
  },
  {
    createSql: `CREATE TRIGGER fts_search_sync_user_memories
      AFTER INSERT OR DELETE OR UPDATE OF captured_at, details, memory_category, memory_layer, status, summary, tags, title, updated_at, user_id ON public.user_memories
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change(
        'userMemories', 'user_id'
      )`,
    name: 'fts_search_sync_user_memories',
    table: 'user_memories',
  },
  {
    createSql: `CREATE TRIGGER fts_search_sync_user_memories_fanout
      AFTER INSERT OR DELETE OR UPDATE OF captured_at, details, memory_category, memory_layer, status, summary, tags, title, user_id ON public.user_memories
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_memory_fanout()`,
    name: 'fts_search_sync_user_memories_fanout',
    table: 'user_memories',
  },
  {
    createSql: `CREATE TRIGGER fts_search_sync_memory_contexts
      AFTER INSERT OR DELETE OR UPDATE OF captured_at, current_status, description, tags, title, type, updated_at, user_id, user_memory_ids ON public.user_memories_contexts
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change(
        'memoryContexts', 'user_id'
      )`,
    name: 'fts_search_sync_memory_contexts',
    table: 'user_memories_contexts',
  },
  {
    createSql: `CREATE TRIGGER fts_search_sync_memory_preferences
      AFTER INSERT OR DELETE OR UPDATE OF captured_at, conclusion_directives, suggestions, tags, type, updated_at, user_id, user_memory_id ON public.user_memories_preferences
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change(
        'memoryPreferences', 'user_id'
      )`,
    name: 'fts_search_sync_memory_preferences',
    table: 'user_memories_preferences',
  },
  {
    createSql: `CREATE TRIGGER fts_search_sync_memory_activities
      AFTER INSERT OR DELETE OR UPDATE OF captured_at, ends_at, feedback, narrative, notes, starts_at, status, tags, type, updated_at, user_id, user_memory_id ON public.user_memories_activities
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change(
        'memoryActivities', 'user_id'
      )`,
    name: 'fts_search_sync_memory_activities',
    table: 'user_memories_activities',
  },
  {
    createSql: `CREATE TRIGGER fts_search_sync_memory_identities
      AFTER INSERT OR DELETE OR UPDATE OF captured_at, description, episodic_date, relationship, role, tags, type, updated_at, user_id, user_memory_id ON public.user_memories_identities
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change(
        'memoryIdentities', 'user_id'
      )`,
    name: 'fts_search_sync_memory_identities',
    table: 'user_memories_identities',
  },
  {
    createSql: `CREATE TRIGGER fts_search_sync_memory_experiences
      AFTER INSERT OR DELETE OR UPDATE OF action, captured_at, key_learning, possible_outcome, reasoning, situation, tags, type, updated_at, user_id, user_memory_id ON public.user_memories_experiences
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change(
        'memoryExperiences', 'user_id'
      )`,
    name: 'fts_search_sync_memory_experiences',
    table: 'user_memories_experiences',
  },
  {
    createSql: `CREATE TRIGGER fts_search_sync_persona_documents
      AFTER INSERT OR DELETE OR UPDATE OF captured_at, persona, profile, tagline, updated_at, user_id, version ON public.user_memory_persona_documents
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_change(
        'personaDocuments', 'user_id'
      )`,
    name: 'fts_search_sync_persona_documents',
    table: 'user_memory_persona_documents',
  },
  {
    createSql: `CREATE TRIGGER fts_search_sync_knowledge_base_files
      AFTER INSERT OR DELETE OR UPDATE OF file_id, knowledge_base_id ON public.knowledge_base_files
      FOR EACH ROW EXECUTE FUNCTION capture_fts_search_sync_knowledge_base_files()`,
    name: 'fts_search_sync_knowledge_base_files',
    table: 'knowledge_base_files',
  },
];

export const normalizeFtsSearchSyncCaptureDefinition = (definition: string) => {
  const compact = definition
    .trim()
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/\(\s+/g, '(')
    .replaceAll(/\s+\)/g, ')');

  /** PostgreSQL renders UPDATE OF columns in table-column order; their SQL order is immaterial. */
  return compact.replace(/UPDATE OF ([\w, ]+) ON /, (_, columns: string) => {
    const normalizedColumns = columns
      .split(',')
      .map((column) => column.trim())
      .toSorted()
      .join(', ');
    return `UPDATE OF ${normalizedColumns} ON `;
  });
};

/** Reconstructs the only earlier trigger revision installed before this feature ships. */
const toPreviousCaptureTriggerDefinition = (definition: string) =>
  definition.replace(/UPDATE OF ([\w, ]+) ON /, (_, columns: string) => {
    const previousColumns = columns
      .split(',')
      .map((column) => column.trim())
      .filter((column) => column !== 'updated_at')
      .join(', ');
    return `UPDATE OF ${previousColumns} ON `;
  });

const createCaptureTriggerStatement = ({ createSql }: CaptureTriggerDefinition) =>
  sql.raw(`${createSql};`);

export const FTS_SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS = CAPTURE_TRIGGER_DEFINITIONS.map(
  ({ createSql, name, table }) => {
    const definition = normalizeFtsSearchSyncCaptureDefinition(createSql);
    const previousDefinition = normalizeFtsSearchSyncCaptureDefinition(
      toPreviousCaptureTriggerDefinition(createSql),
    );

    return {
      definition,
      name,
      previousDefinitions: previousDefinition === definition ? [] : [previousDefinition],
      table,
    };
  },
);

export const FTS_SEARCH_SYNC_CAPTURE_TRIGGER_STATEMENTS = CAPTURE_TRIGGER_DEFINITIONS.map(
  createCaptureTriggerStatement,
);

/** Changes whenever a function body, trigger definition, or trigger target changes. */
export const FTS_SEARCH_SYNC_CAPTURE_FINGERPRINT = createHash('sha256')
  .update(
    JSON.stringify({
      functions: FTS_SEARCH_SYNC_CAPTURE_FUNCTION_TARGETS,
      triggers: FTS_SEARCH_SYNC_CAPTURE_TRIGGER_TARGETS,
    }),
  )
  .digest('hex');

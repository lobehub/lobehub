import type { SearchDocumentEntity, SearchDocumentSourceMap } from './schema';

export type ElasticsearchFieldType = 'boolean' | 'date' | 'integer' | 'keyword' | 'text';

export interface ElasticsearchMappingProperty {
  analyzer?: string;
  fields?: Record<string, ElasticsearchMappingProperty>;
  type: ElasticsearchFieldType;
}

export interface SearchIndexDefinition<Entity extends SearchDocumentEntity> {
  indexedOnlyFields?: readonly (keyof SearchDocumentSourceMap[Entity] & string)[];
  longTextFields?: readonly (keyof SearchDocumentSourceMap[Entity] & string)[];
  mappings: {
    dynamic: 'strict';
    properties: Record<
      keyof SearchDocumentSourceMap[Entity] & string,
      ElasticsearchMappingProperty
    >;
  };
  queryFields: readonly (keyof SearchDocumentSourceMap[Entity] & string)[];
  sourceTable: string;
}

const mixedText = { analyzer: 'lobehub_icu_english', type: 'text' } as const;
const mixedTextWithRaw = {
  analyzer: 'lobehub_icu_english',
  fields: { raw: { type: 'keyword' } },
  type: 'text',
} as const;
const icuText = {
  analyzer: 'lobehub_icu',
  fields: { raw: { type: 'keyword' } },
  type: 'text',
} as const;
const keyword = { type: 'keyword' } as const;
const date = { type: 'date' } as const;
const integer = { type: 'integer' } as const;
const boolean = { type: 'boolean' } as const;

const ownershipProperties = {
  user_id: keyword,
  visibility: keyword,
  workspace_id: keyword,
};

const timestampProperties = {
  created_at: date,
  updated_at: date,
};

export const SEARCH_INDEX_ANALYSIS = {
  analyzer: {
    lobehub_icu: {
      filter: ['icu_folding'],
      tokenizer: 'icu_tokenizer',
      type: 'custom',
    },
    lobehub_icu_english: {
      filter: ['english_possessive_stemmer', 'icu_folding', 'english_stop', 'english_stemmer'],
      tokenizer: 'icu_tokenizer',
      type: 'custom',
    },
  },
  filter: {
    english_possessive_stemmer: {
      language: 'possessive_english',
      type: 'stemmer',
    },
    english_stemmer: {
      language: 'english',
      type: 'stemmer',
    },
    english_stop: {
      stopwords: '_english_',
      type: 'stop',
    },
  },
} as const;

export const SEARCH_INDEX_DEFINITIONS = {
  agents: {
    longTextFields: ['system_role'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...ownershipProperties,
        ...timestampProperties,
        description: mixedText,
        id: keyword,
        slug: icuText,
        system_role: mixedText,
        tags: icuText,
        title: mixedText,
        virtual: boolean,
      },
    },
    queryFields: ['title', 'description', 'slug', 'tags', 'system_role'],
    sourceTable: 'agents',
  } satisfies SearchIndexDefinition<'agents'>,
  chatGroups: {
    indexedOnlyFields: ['content'],
    longTextFields: ['content'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...ownershipProperties,
        ...timestampProperties,
        content: mixedText,
        description: mixedText,
        group_id: keyword,
        id: keyword,
        title: mixedText,
      },
    },
    queryFields: ['title', 'description', 'content'],
    sourceTable: 'chat_groups',
  } satisfies SearchIndexDefinition<'chatGroups'>,
  documents: {
    longTextFields: ['content'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...ownershipProperties,
        ...timestampProperties,
        content: mixedText,
        description: mixedText,
        file_id: keyword,
        file_type: keyword,
        id: keyword,
        knowledge_base_id: keyword,
        knowledge_base_ids: keyword,
        parent_id: keyword,
        slug: icuText,
        source_type: keyword,
        title: mixedText,
        total_char_count: integer,
      },
    },
    queryFields: ['title', 'slug', 'description', 'content'],
    sourceTable: 'documents',
  } satisfies SearchIndexDefinition<'documents'>,
  files: {
    mappings: {
      dynamic: 'strict',
      properties: {
        ...ownershipProperties,
        ...timestampProperties,
        file_type: keyword,
        id: keyword,
        knowledge_base_ids: keyword,
        name: icuText,
        size: integer,
        source: keyword,
      },
    },
    queryFields: ['name'],
    sourceTable: 'files',
  } satisfies SearchIndexDefinition<'files'>,
  knowledgeBases: {
    longTextFields: ['description'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...ownershipProperties,
        ...timestampProperties,
        description: mixedText,
        id: keyword,
        is_public: boolean,
        name: icuText,
        type: keyword,
      },
    },
    queryFields: ['name', 'description'],
    sourceTable: 'knowledge_bases',
  } satisfies SearchIndexDefinition<'knowledgeBases'>,
  memoryActivities: {
    longTextFields: ['notes', 'narrative', 'feedback'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...timestampProperties,
        captured_at: date,
        ends_at: date,
        feedback: mixedText,
        id: keyword,
        narrative: mixedText,
        notes: mixedText,
        parent_details: mixedText,
        parent_memory_categories: keyword,
        parent_summary: mixedText,
        parent_tags: keyword,
        parent_title: mixedText,
        starts_at: date,
        status: keyword,
        tags: keyword,
        type: keyword,
        user_id: keyword,
        user_memory_id: keyword,
      },
    },
    queryFields: [
      'parent_title',
      'parent_summary',
      'parent_details',
      'narrative',
      'notes',
      'feedback',
    ],
    sourceTable: 'user_memories_activities',
  } satisfies SearchIndexDefinition<'memoryActivities'>,
  memoryContexts: {
    longTextFields: ['description', 'current_status'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...timestampProperties,
        captured_at: date,
        current_status: mixedTextWithRaw,
        description: mixedText,
        id: keyword,
        parent_text: mixedText,
        parent_memory_categories: keyword,
        parent_tags: keyword,
        tags: keyword,
        title: mixedText,
        type: keyword,
        user_id: keyword,
        user_memory_ids: keyword,
      },
    },
    queryFields: ['parent_text', 'title', 'description', 'current_status'],
    sourceTable: 'user_memories_contexts',
  } satisfies SearchIndexDefinition<'memoryContexts'>,
  memoryExperiences: {
    longTextFields: ['situation', 'reasoning', 'possible_outcome', 'action', 'key_learning'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...timestampProperties,
        action: mixedText,
        captured_at: date,
        id: keyword,
        key_learning: mixedText,
        parent_details: mixedText,
        parent_memory_categories: keyword,
        parent_summary: mixedText,
        parent_tags: keyword,
        parent_title: mixedText,
        possible_outcome: mixedText,
        reasoning: mixedText,
        situation: mixedText,
        tags: keyword,
        type: keyword,
        user_id: keyword,
        user_memory_id: keyword,
      },
    },
    queryFields: [
      'parent_title',
      'parent_summary',
      'parent_details',
      'situation',
      'reasoning',
      'possible_outcome',
      'action',
      'key_learning',
    ],
    sourceTable: 'user_memories_experiences',
  } satisfies SearchIndexDefinition<'memoryExperiences'>,
  memoryIdentities: {
    longTextFields: ['description', 'role'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...timestampProperties,
        captured_at: date,
        description: mixedText,
        episodic_date: date,
        id: keyword,
        parent_details: mixedText,
        parent_memory_categories: keyword,
        parent_summary: mixedText,
        parent_tags: keyword,
        parent_title: mixedText,
        relationship: keyword,
        role: mixedText,
        tags: keyword,
        type: keyword,
        user_id: keyword,
        user_memory_id: keyword,
      },
    },
    queryFields: ['parent_title', 'parent_summary', 'parent_details', 'description', 'role'],
    sourceTable: 'user_memories_identities',
  } satisfies SearchIndexDefinition<'memoryIdentities'>,
  memoryPreferences: {
    longTextFields: ['conclusion_directives', 'suggestions'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...timestampProperties,
        captured_at: date,
        conclusion_directives: mixedText,
        id: keyword,
        parent_details: mixedText,
        parent_memory_categories: keyword,
        parent_summary: mixedText,
        parent_tags: keyword,
        parent_title: mixedText,
        suggestions: mixedText,
        tags: keyword,
        type: keyword,
        user_id: keyword,
        user_memory_id: keyword,
      },
    },
    queryFields: [
      'parent_title',
      'parent_summary',
      'parent_details',
      'conclusion_directives',
      'suggestions',
    ],
    sourceTable: 'user_memories_preferences',
  } satisfies SearchIndexDefinition<'memoryPreferences'>,
  messages: {
    indexedOnlyFields: ['summary'],
    longTextFields: ['content', 'summary'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...timestampProperties,
        agent_id: keyword,
        content: mixedText,
        group_id: keyword,
        id: keyword,
        role: keyword,
        session_id: keyword,
        summary: mixedText,
        thread_id: keyword,
        topic_id: keyword,
        user_id: keyword,
        workspace_id: keyword,
      },
    },
    queryFields: ['content', 'summary'],
    sourceTable: 'messages',
  } satisfies SearchIndexDefinition<'messages'>,
  personaDocuments: {
    longTextFields: ['persona'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...timestampProperties,
        captured_at: date,
        id: keyword,
        persona: mixedText,
        profile: keyword,
        tagline: mixedText,
        user_id: keyword,
        version: integer,
      },
    },
    queryFields: ['tagline', 'persona'],
    sourceTable: 'user_memory_persona_documents',
  } satisfies SearchIndexDefinition<'personaDocuments'>,
  topics: {
    longTextFields: ['content'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...timestampProperties,
        agent_id: keyword,
        content: mixedText,
        description: mixedText,
        group_id: keyword,
        id: keyword,
        session_id: keyword,
        status: keyword,
        title: mixedText,
        user_id: keyword,
        workspace_id: keyword,
      },
    },
    queryFields: ['title', 'content', 'description'],
    sourceTable: 'topics',
  } satisfies SearchIndexDefinition<'topics'>,
  userMemories: {
    longTextFields: ['details'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...timestampProperties,
        captured_at: date,
        details: mixedText,
        id: keyword,
        memory_category: keyword,
        memory_layer: keyword,
        status: keyword,
        summary: mixedText,
        tags: keyword,
        title: mixedText,
        user_id: keyword,
      },
    },
    queryFields: ['title', 'summary', 'details'],
    sourceTable: 'user_memories',
  } satisfies SearchIndexDefinition<'userMemories'>,
} as const satisfies {
  [Entity in SearchDocumentEntity]: SearchIndexDefinition<Entity>;
};

export const SEARCH_INDEX_SCHEMA_VERSION = 1;

const toIndexSegment = (entity: SearchDocumentEntity) =>
  entity.replaceAll(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);

/** Namespace is deployment-owned so OSS does not encode environment or tenant policy. */
export const getSearchIndexAlias = (namespace: string, entity: SearchDocumentEntity) =>
  `${namespace}-${toIndexSegment(entity)}`;

export const getSearchPhysicalIndexName = (
  namespace: string,
  entity: SearchDocumentEntity,
  version: number = SEARCH_INDEX_SCHEMA_VERSION,
) => `${getSearchIndexAlias(namespace, entity)}-v${version}`;

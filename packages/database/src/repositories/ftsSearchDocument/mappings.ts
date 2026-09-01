import type { FtsSearchDocumentEntity, FtsSearchDocumentSourceMap } from './schema';

export type ElasticsearchFtsSearchFieldType = 'boolean' | 'date' | 'integer' | 'keyword' | 'text';

export interface ElasticsearchFtsSearchMappingProperty {
  analyzer?: string;
  fields?: Record<string, ElasticsearchFtsSearchMappingProperty>;
  ignore_above?: number;
  type: ElasticsearchFtsSearchFieldType;
}

export interface FtsSearchIndexDefinition<Entity extends FtsSearchDocumentEntity> {
  indexedOnlyFields?: readonly (keyof FtsSearchDocumentSourceMap[Entity] & string)[];
  longTextFields?: readonly (keyof FtsSearchDocumentSourceMap[Entity] & string)[];
  mappings: {
    dynamic: 'strict';
    properties: Record<
      keyof FtsSearchDocumentSourceMap[Entity] & string,
      ElasticsearchFtsSearchMappingProperty
    >;
  };
  queryFields: readonly (keyof FtsSearchDocumentSourceMap[Entity] & string)[];
}

const mixedText = { analyzer: 'lobehub_icu_english', type: 'text' } as const;
const memoryText = { analyzer: 'lobehub_cjk_bigram_english', type: 'text' } as const;
const memoryTextWithRaw = {
  analyzer: 'lobehub_cjk_bigram_english',
  fields: { raw: { ignore_above: 256, type: 'keyword' } },
  type: 'text',
} as const;
const fileNameText = {
  analyzer: 'lobehub_filename',
  fields: {
    raw: { ignore_above: 256, type: 'keyword' },
    words: { analyzer: 'lobehub_icu', type: 'text' },
  },
  type: 'text',
} as const;
const icuText = {
  analyzer: 'lobehub_icu',
  fields: { raw: { ignore_above: 256, type: 'keyword' } },
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

const projectionMetadataProperties = {
  fts_search_sync_deleted: boolean,
};

export const FTS_SEARCH_INDEX_ANALYSIS = {
  analyzer: {
    lobehub_cjk_bigram_english: {
      /** Normalize width and case before generating CJK bigrams so decomposed characters stay intact. */
      filter: [
        'english_possessive_stemmer',
        'icu_folding',
        'cjk_bigram',
        'english_stop',
        'english_stemmer',
      ],
      tokenizer: 'standard',
      type: 'custom',
    },
    lobehub_filename: {
      filter: ['icu_folding'],
      tokenizer: 'lobehub_filename',
      type: 'custom',
    },
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
  tokenizer: {
    lobehub_filename: {
      tokenize_on_chars: ['whitespace', '-', '_', '/', '.'],
      type: 'char_group',
    },
  },
} as const;

export const FTS_SEARCH_INDEX_DEFINITIONS = {
  agents: {
    longTextFields: ['system_role'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...ownershipProperties,
        ...projectionMetadataProperties,
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
  } satisfies FtsSearchIndexDefinition<'agents'>,
  chatGroups: {
    indexedOnlyFields: ['content'],
    longTextFields: ['content'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...ownershipProperties,
        ...projectionMetadataProperties,
        ...timestampProperties,
        content: mixedText,
        description: mixedText,
        group_id: keyword,
        id: keyword,
        title: mixedText,
      },
    },
    queryFields: ['title', 'description', 'content'],
  } satisfies FtsSearchIndexDefinition<'chatGroups'>,
  documents: {
    longTextFields: ['content'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...ownershipProperties,
        ...projectionMetadataProperties,
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
  } satisfies FtsSearchIndexDefinition<'documents'>,
  files: {
    mappings: {
      dynamic: 'strict',
      properties: {
        ...ownershipProperties,
        ...projectionMetadataProperties,
        ...timestampProperties,
        file_type: keyword,
        id: keyword,
        knowledge_base_ids: keyword,
        name: fileNameText,
        size: integer,
        source: keyword,
      },
    },
    /** Provider-neutral source field; Elasticsearch-only multi-fields are selected by its backend. */
    queryFields: ['name'],
  } satisfies FtsSearchIndexDefinition<'files'>,
  knowledgeBases: {
    longTextFields: ['description'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...ownershipProperties,
        ...projectionMetadataProperties,
        ...timestampProperties,
        description: mixedText,
        id: keyword,
        is_public: boolean,
        name: icuText,
        type: keyword,
      },
    },
    queryFields: ['name', 'description'],
  } satisfies FtsSearchIndexDefinition<'knowledgeBases'>,
  memoryActivities: {
    longTextFields: ['notes', 'narrative', 'feedback'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...projectionMetadataProperties,
        ...timestampProperties,
        captured_at: date,
        ends_at: date,
        feedback: memoryText,
        id: keyword,
        narrative: memoryText,
        notes: memoryText,
        parent_details: memoryText,
        parent_memory_categories: keyword,
        parent_summary: memoryText,
        parent_tags: keyword,
        parent_title: memoryText,
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
  } satisfies FtsSearchIndexDefinition<'memoryActivities'>,
  memoryContexts: {
    longTextFields: ['description', 'current_status'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...projectionMetadataProperties,
        ...timestampProperties,
        captured_at: date,
        current_status: memoryTextWithRaw,
        description: memoryText,
        id: keyword,
        parent_text: memoryText,
        parent_memory_categories: keyword,
        parent_tags: keyword,
        tags: keyword,
        title: memoryText,
        type: keyword,
        user_id: keyword,
        user_memory_ids: keyword,
      },
    },
    queryFields: ['parent_text', 'title', 'description', 'current_status'],
  } satisfies FtsSearchIndexDefinition<'memoryContexts'>,
  memoryExperiences: {
    longTextFields: ['situation', 'reasoning', 'possible_outcome', 'action', 'key_learning'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...projectionMetadataProperties,
        ...timestampProperties,
        action: memoryText,
        captured_at: date,
        id: keyword,
        key_learning: memoryText,
        parent_details: memoryText,
        parent_memory_categories: keyword,
        parent_summary: memoryText,
        parent_tags: keyword,
        parent_title: memoryText,
        possible_outcome: memoryText,
        reasoning: memoryText,
        situation: memoryText,
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
  } satisfies FtsSearchIndexDefinition<'memoryExperiences'>,
  memoryIdentities: {
    longTextFields: ['description', 'role'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...projectionMetadataProperties,
        ...timestampProperties,
        captured_at: date,
        description: memoryText,
        episodic_date: date,
        id: keyword,
        parent_details: memoryText,
        parent_memory_categories: keyword,
        parent_summary: memoryText,
        parent_tags: keyword,
        parent_title: memoryText,
        relationship: keyword,
        role: memoryText,
        tags: keyword,
        type: keyword,
        user_id: keyword,
        user_memory_id: keyword,
      },
    },
    queryFields: ['parent_title', 'parent_summary', 'parent_details', 'description', 'role'],
  } satisfies FtsSearchIndexDefinition<'memoryIdentities'>,
  memoryPreferences: {
    longTextFields: ['conclusion_directives', 'suggestions'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...projectionMetadataProperties,
        ...timestampProperties,
        captured_at: date,
        conclusion_directives: memoryText,
        id: keyword,
        parent_details: memoryText,
        parent_memory_categories: keyword,
        parent_summary: memoryText,
        parent_tags: keyword,
        parent_title: memoryText,
        suggestions: memoryText,
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
  } satisfies FtsSearchIndexDefinition<'memoryPreferences'>,
  messages: {
    indexedOnlyFields: ['summary'],
    longTextFields: ['content', 'summary'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...projectionMetadataProperties,
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
  } satisfies FtsSearchIndexDefinition<'messages'>,
  personaDocuments: {
    longTextFields: ['persona'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...projectionMetadataProperties,
        ...timestampProperties,
        captured_at: date,
        id: keyword,
        persona: memoryText,
        profile: keyword,
        tagline: memoryText,
        user_id: keyword,
        version: integer,
      },
    },
    queryFields: ['tagline', 'persona'],
  } satisfies FtsSearchIndexDefinition<'personaDocuments'>,
  topics: {
    longTextFields: ['content'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...projectionMetadataProperties,
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
  } satisfies FtsSearchIndexDefinition<'topics'>,
  userMemories: {
    longTextFields: ['details'],
    mappings: {
      dynamic: 'strict',
      properties: {
        ...projectionMetadataProperties,
        ...timestampProperties,
        captured_at: date,
        details: memoryText,
        id: keyword,
        memory_category: keyword,
        memory_layer: keyword,
        status: keyword,
        summary: memoryText,
        tags: keyword,
        title: memoryText,
        user_id: keyword,
      },
    },
    queryFields: ['title', 'summary', 'details'],
  } satisfies FtsSearchIndexDefinition<'userMemories'>,
} as const satisfies {
  [Entity in FtsSearchDocumentEntity]: FtsSearchIndexDefinition<Entity>;
};

/** First production Elasticsearch mapping version. Development-only iterations were never shipped. */
export const FTS_SEARCH_INDEX_SCHEMA_VERSION = 1;

const toIndexSegment = (entity: FtsSearchDocumentEntity) =>
  entity.replaceAll(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);

/** Namespace is deployment-owned so OSS does not encode environment or tenant policy. */
export const getFtsSearchIndexAlias = (namespace: string, entity: FtsSearchDocumentEntity) =>
  `${namespace}-${toIndexSegment(entity)}`;

export const getFtsSearchPhysicalIndexName = (
  namespace: string,
  entity: FtsSearchDocumentEntity,
  version: number = FTS_SEARCH_INDEX_SCHEMA_VERSION,
) => `${getFtsSearchIndexAlias(namespace, entity)}-v${version}`;

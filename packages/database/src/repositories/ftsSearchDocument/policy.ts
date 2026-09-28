import type { ElasticsearchFtsSearchMappingProperty } from './migration/types';
import type { FtsSearchDocumentEntity, FtsSearchDocumentSourceMap } from './zodSchema';

export interface FtsSearchIndexPolicy<Entity extends FtsSearchDocumentEntity> {
  indexedOnlyFields?: readonly (keyof FtsSearchDocumentSourceMap[Entity] & string)[];
  longTextFields?: readonly (keyof FtsSearchDocumentSourceMap[Entity] & string)[];
  queryFields: readonly (keyof FtsSearchDocumentSourceMap[Entity] & string)[];
}

type FtsSearchRetainedSourceProperties = {
  [Entity in FtsSearchDocumentEntity]: Partial<
    Record<keyof FtsSearchDocumentSourceMap[Entity] & string, ElasticsearchFtsSearchMappingProperty>
  >;
};

/**
 * Fields retained in the current document source only to keep older open generations writable.
 * They are excluded from the current physical mapping and must not be used by current queries.
 */
export const FTS_SEARCH_RETAINED_SOURCE_PROPERTIES = {
  agents: {},
  chatGroups: {},
  documents: {},
  files: {},
  knowledgeBases: {},
  memoryActivities: {},
  memoryContexts: {},
  memoryExperiences: {},
  memoryIdentities: {},
  memoryPreferences: {},
  messages: {},
  personaDocuments: {},
  topics: {},
  userMemories: {},
} as const satisfies FtsSearchRetainedSourceProperties;

/** Current document metadata, independent of physical mapping history. */
export const FTS_SEARCH_INDEX_POLICY = {
  agents: {
    longTextFields: ['system_role'],
    queryFields: ['title', 'description', 'slug', 'tags', 'system_role'],
  },
  chatGroups: {
    indexedOnlyFields: ['content'],
    longTextFields: ['content'],
    queryFields: ['title', 'description', 'content'],
  },
  documents: {
    longTextFields: ['content'],
    queryFields: ['title', 'slug', 'description', 'content'],
  },
  files: {
    /** Provider-neutral source field; Elasticsearch-only multi-fields are selected by its backend. */
    queryFields: ['name'],
  },
  knowledgeBases: {
    longTextFields: ['description'],
    queryFields: ['name', 'description'],
  },
  memoryActivities: {
    longTextFields: ['notes', 'narrative', 'feedback'],
    queryFields: [
      'parent_title',
      'parent_summary',
      'parent_details',
      'narrative',
      'notes',
      'feedback',
    ],
  },
  memoryContexts: {
    longTextFields: ['description', 'current_status'],
    queryFields: ['parent_text', 'title', 'description', 'current_status'],
  },
  memoryExperiences: {
    longTextFields: ['situation', 'reasoning', 'possible_outcome', 'action', 'key_learning'],
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
  },
  memoryIdentities: {
    longTextFields: ['description', 'role'],
    queryFields: ['parent_title', 'parent_summary', 'parent_details', 'description', 'role'],
  },
  memoryPreferences: {
    longTextFields: ['conclusion_directives', 'suggestions'],
    queryFields: [
      'parent_title',
      'parent_summary',
      'parent_details',
      'conclusion_directives',
      'suggestions',
    ],
  },
  messages: {
    indexedOnlyFields: ['summary'],
    longTextFields: ['content', 'summary'],
    queryFields: ['content', 'summary'],
  },
  personaDocuments: {
    longTextFields: ['persona'],
    queryFields: ['tagline', 'persona'],
  },
  topics: {
    longTextFields: ['content'],
    queryFields: ['title', 'content', 'description'],
  },
  userMemories: {
    longTextFields: ['details'],
    queryFields: ['title', 'summary', 'details'],
  },
} as const satisfies { [Entity in FtsSearchDocumentEntity]: FtsSearchIndexPolicy<Entity> };

import type { FtsSearchMemoryDocumentEntity } from '../../ftsSearchDocument';
import type { FtsSearchBackendEntity } from '../types';

export const ELASTICSEARCH_FTS_SEARCH_CONVERSATION_QUERY_FIELDS = {
  agents: ['title^5', 'slug^4', 'tags^3', 'description^2', 'system_role'],
  chatGroups: ['title^4', 'description^2', 'content'],
  messages: ['content^2', 'summary'],
  topics: ['title', 'content', 'description'],
} as const;

export type ElasticsearchFtsSearchConversationEntity =
  keyof typeof ELASTICSEARCH_FTS_SEARCH_CONVERSATION_QUERY_FIELDS;

export const isElasticsearchFtsSearchConversationEntity = (
  entity: FtsSearchBackendEntity,
): entity is ElasticsearchFtsSearchConversationEntity =>
  Object.hasOwn(ELASTICSEARCH_FTS_SEARCH_CONVERSATION_QUERY_FIELDS, entity);

export const ELASTICSEARCH_FTS_SEARCH_RESOURCE_QUERY_FIELDS = {
  files: ['name.raw^8', 'name^4', 'name.words^2'],
  knowledgeBases: ['name^4', 'description'],
} as const;

export const ELASTICSEARCH_FTS_SEARCH_DOCUMENT_QUERY_FIELDS = {
  folder: ['title^4', 'slug^3', 'description^2'],
  knowledgeBaseDocument: ['title^4', 'slug^3', 'content'],
  page: ['title^4', 'slug^3', 'content'],
} as const;

export type ElasticsearchFtsSearchResourceEntity =
  keyof typeof ELASTICSEARCH_FTS_SEARCH_RESOURCE_QUERY_FIELDS | 'documents';

export const isElasticsearchFtsSearchResourceEntity = (
  entity: FtsSearchBackendEntity,
): entity is ElasticsearchFtsSearchResourceEntity =>
  entity === 'documents' || Object.hasOwn(ELASTICSEARCH_FTS_SEARCH_RESOURCE_QUERY_FIELDS, entity);

export const ELASTICSEARCH_FTS_SEARCH_MEMORY_QUERY_FIELDS = {
  memoryActivities: [
    'parent_title',
    'parent_summary',
    'parent_details',
    'narrative',
    'notes',
    'feedback',
  ],
  memoryContexts: ['parent_text', 'title', 'description', 'current_status'],
  memoryExperiences: [
    'parent_title',
    'parent_summary',
    'parent_details',
    'situation',
    'reasoning',
    'possible_outcome',
    'action',
    'key_learning',
  ],
  memoryIdentities: ['parent_title', 'parent_summary', 'parent_details', 'description', 'role'],
  memoryPreferences: [
    'parent_title',
    'parent_summary',
    'parent_details',
    'conclusion_directives',
    'suggestions',
  ],
  personaDocuments: ['tagline', 'persona'],
  userMemories: ['title^4', 'summary^2', 'details'],
} as const satisfies Record<FtsSearchMemoryDocumentEntity, readonly string[]>;

export type ElasticsearchFtsSearchMemoryEntity =
  keyof typeof ELASTICSEARCH_FTS_SEARCH_MEMORY_QUERY_FIELDS;

export const isElasticsearchFtsSearchMemoryEntity = (
  entity: FtsSearchBackendEntity,
): entity is ElasticsearchFtsSearchMemoryEntity =>
  Object.hasOwn(ELASTICSEARCH_FTS_SEARCH_MEMORY_QUERY_FIELDS, entity);

/** Agent mail is candidate-only: the mail model hydrates and authorizes the ids. */
export const ELASTICSEARCH_FTS_SEARCH_MAIL_QUERY_FIELDS = {
  agentMails: ['subject^4', 'from_name^3', 'from_address^3', 'recipients^2', 'text'],
} as const;

export type ElasticsearchFtsSearchMailEntity =
  keyof typeof ELASTICSEARCH_FTS_SEARCH_MAIL_QUERY_FIELDS;

export const isElasticsearchFtsSearchMailEntity = (
  entity: FtsSearchBackendEntity,
): entity is ElasticsearchFtsSearchMailEntity =>
  Object.hasOwn(ELASTICSEARCH_FTS_SEARCH_MAIL_QUERY_FIELDS, entity);

export type ElasticsearchFtsSearchEntity =
  | ElasticsearchFtsSearchConversationEntity
  | ElasticsearchFtsSearchMailEntity
  | ElasticsearchFtsSearchMemoryEntity
  | ElasticsearchFtsSearchResourceEntity;

export const isElasticsearchFtsSearchEntity = (
  entity: FtsSearchBackendEntity,
): entity is ElasticsearchFtsSearchEntity =>
  isElasticsearchFtsSearchConversationEntity(entity) ||
  isElasticsearchFtsSearchMailEntity(entity) ||
  isElasticsearchFtsSearchMemoryEntity(entity) ||
  isElasticsearchFtsSearchResourceEntity(entity);

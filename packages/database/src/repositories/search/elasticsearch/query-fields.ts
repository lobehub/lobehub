import type { MemorySearchDocumentEntity } from '../../searchDocument';
import type { SearchBackendEntity } from '../types';

export const ELASTICSEARCH_CONVERSATION_QUERY_FIELDS = {
  agents: ['title^5', 'slug^4', 'tags^3', 'description^2', 'system_role'],
  chatGroups: ['title^4', 'description^2', 'content'],
  messages: ['content^2', 'summary'],
  topics: ['title', 'content', 'description'],
} as const;

export type ElasticsearchConversationEntity = keyof typeof ELASTICSEARCH_CONVERSATION_QUERY_FIELDS;

export const isElasticsearchConversationEntity = (
  entity: SearchBackendEntity,
): entity is ElasticsearchConversationEntity =>
  Object.hasOwn(ELASTICSEARCH_CONVERSATION_QUERY_FIELDS, entity);

export const ELASTICSEARCH_RESOURCE_QUERY_FIELDS = {
  files: ['name.raw^8', 'name^4', 'name.words^2'],
  knowledgeBases: ['name^4', 'description'],
} as const;

export const ELASTICSEARCH_DOCUMENT_QUERY_FIELDS = {
  folder: ['title^4', 'slug^3', 'description^2'],
  knowledgeBaseDocument: ['title^4', 'slug^3', 'content'],
  page: ['title^4', 'slug^3', 'content'],
} as const;

export type ElasticsearchResourceEntity =
  keyof typeof ELASTICSEARCH_RESOURCE_QUERY_FIELDS | 'documents';

export const isElasticsearchResourceEntity = (
  entity: SearchBackendEntity,
): entity is ElasticsearchResourceEntity =>
  entity === 'documents' || Object.hasOwn(ELASTICSEARCH_RESOURCE_QUERY_FIELDS, entity);

export const ELASTICSEARCH_MEMORY_QUERY_FIELDS = {
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
} as const satisfies Record<MemorySearchDocumentEntity, readonly string[]>;

export type ElasticsearchMemoryEntity = keyof typeof ELASTICSEARCH_MEMORY_QUERY_FIELDS;

export const isElasticsearchMemoryEntity = (
  entity: SearchBackendEntity,
): entity is ElasticsearchMemoryEntity => Object.hasOwn(ELASTICSEARCH_MEMORY_QUERY_FIELDS, entity);

export type ElasticsearchSearchEntity =
  ElasticsearchConversationEntity | ElasticsearchMemoryEntity | ElasticsearchResourceEntity;

export const isElasticsearchSearchEntity = (
  entity: SearchBackendEntity,
): entity is ElasticsearchSearchEntity =>
  isElasticsearchConversationEntity(entity) ||
  isElasticsearchMemoryEntity(entity) ||
  isElasticsearchResourceEntity(entity);

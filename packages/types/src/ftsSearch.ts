export const FTS_SEARCH_DOCUMENT_ENTITIES = [
  'agents',
  'topics',
  'files',
  'knowledgeBases',
  'userMemories',
  'chatGroups',
  'memoryContexts',
  'memoryPreferences',
  'memoryActivities',
  'memoryIdentities',
  'memoryExperiences',
  'personaDocuments',
  'documents',
  'messages',
] as const;

export type FtsSearchDocumentEntity = (typeof FTS_SEARCH_DOCUMENT_ENTITIES)[number];

export type FtsSearchReindexEntityStatus = 'pending' | 'backfilling' | 'completed';

export type FtsSearchReindexRunStatus =
  'backfilling' | 'ready_for_incremental_sync' | 'completed' | 'failed';

import type { FtsSearchDocumentEntity } from '../zodSchema';
import { initialSearchIndexes } from './0000-initial-search-indexes/mapping';
import type { FtsSearchMappingMigration } from './types';

/** Source-history batches, not a sequential migration executor. Register every batch explicitly. */
export const FTS_SEARCH_MAPPING_MIGRATIONS = [
  initialSearchIndexes,
] as const satisfies readonly FtsSearchMappingMigration[];

/** Select the latest batch containing each entity; unaffected entities retain their prior batch. */
export const FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS = {
  agents: initialSearchIndexes,
  chatGroups: initialSearchIndexes,
  documents: initialSearchIndexes,
  files: initialSearchIndexes,
  knowledgeBases: initialSearchIndexes,
  memoryActivities: initialSearchIndexes,
  memoryContexts: initialSearchIndexes,
  memoryExperiences: initialSearchIndexes,
  memoryIdentities: initialSearchIndexes,
  memoryPreferences: initialSearchIndexes,
  messages: initialSearchIndexes,
  personaDocuments: initialSearchIndexes,
  topics: initialSearchIndexes,
  userMemories: initialSearchIndexes,
} as const satisfies Record<FtsSearchDocumentEntity, FtsSearchMappingMigration>;

/** Analysis remains global: changing it requires new physical versions for every current entity. */
export const FTS_SEARCH_INDEX_ANALYSIS = initialSearchIndexes.analysis;

export const FTS_SEARCH_CURRENT_MAPPINGS = {
  agents: FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS.agents.definitions.agents,
  chatGroups: FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS.chatGroups.definitions.chatGroups,
  documents: FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS.documents.definitions.documents,
  files: FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS.files.definitions.files,
  knowledgeBases: FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS.knowledgeBases.definitions.knowledgeBases,
  memoryActivities:
    FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS.memoryActivities.definitions.memoryActivities,
  memoryContexts: FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS.memoryContexts.definitions.memoryContexts,
  memoryExperiences:
    FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS.memoryExperiences.definitions.memoryExperiences,
  memoryIdentities:
    FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS.memoryIdentities.definitions.memoryIdentities,
  memoryPreferences:
    FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS.memoryPreferences.definitions.memoryPreferences,
  messages: FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS.messages.definitions.messages,
  personaDocuments:
    FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS.personaDocuments.definitions.personaDocuments,
  topics: FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS.topics.definitions.topics,
  userMemories: FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS.userMemories.definitions.userMemories,
} as const;

import { FTS_SEARCH_CURRENT_MAPPINGS } from './migration';
import type { ElasticsearchFtsSearchMappingProperty } from './migration/types';
import type { FTS_SEARCH_RETAINED_SOURCE_PROPERTIES, FtsSearchIndexPolicy } from './policy';
import { FTS_SEARCH_INDEX_POLICY } from './policy';
import type { FtsSearchDocumentEntity, FtsSearchDocumentSourceMap } from './zodSchema';

export { FTS_SEARCH_INDEX_ANALYSIS } from './migration';
export type {
  ElasticsearchFtsSearchFieldType,
  ElasticsearchFtsSearchMappingProperty,
} from './migration/types';

export interface FtsSearchIndexDefinition<
  Entity extends FtsSearchDocumentEntity,
> extends FtsSearchIndexPolicy<Entity> {
  mappings: {
    dynamic: 'strict';
    properties: Record<
      Exclude<
        keyof FtsSearchDocumentSourceMap[Entity] & string,
        keyof (typeof FTS_SEARCH_RETAINED_SOURCE_PROPERTIES)[Entity]
      >,
      ElasticsearchFtsSearchMappingProperty
    >;
  };
  /**
   * Physical index generation for this entity. Elasticsearch cannot alter most mapping parameters
   * in place, so any change to `mappings` or the shared analysis must bump this number; the new
   * generation is rebuilt from PostgreSQL into `<alias>-v<schemaVersion>` and promoted by moving
   * the alias. The fingerprint gate test in `mappings.test.ts` enforces the bump.
   */
  schemaVersion: number;
}

/** Public current definitions; history and current query metadata have separate owners. */
export const FTS_SEARCH_INDEX_DEFINITIONS = {
  agents: { ...FTS_SEARCH_CURRENT_MAPPINGS.agents, ...FTS_SEARCH_INDEX_POLICY.agents },
  chatGroups: { ...FTS_SEARCH_CURRENT_MAPPINGS.chatGroups, ...FTS_SEARCH_INDEX_POLICY.chatGroups },
  documents: { ...FTS_SEARCH_CURRENT_MAPPINGS.documents, ...FTS_SEARCH_INDEX_POLICY.documents },
  files: { ...FTS_SEARCH_CURRENT_MAPPINGS.files, ...FTS_SEARCH_INDEX_POLICY.files },
  knowledgeBases: {
    ...FTS_SEARCH_CURRENT_MAPPINGS.knowledgeBases,
    ...FTS_SEARCH_INDEX_POLICY.knowledgeBases,
  },
  memoryActivities: {
    ...FTS_SEARCH_CURRENT_MAPPINGS.memoryActivities,
    ...FTS_SEARCH_INDEX_POLICY.memoryActivities,
  },
  memoryContexts: {
    ...FTS_SEARCH_CURRENT_MAPPINGS.memoryContexts,
    ...FTS_SEARCH_INDEX_POLICY.memoryContexts,
  },
  memoryExperiences: {
    ...FTS_SEARCH_CURRENT_MAPPINGS.memoryExperiences,
    ...FTS_SEARCH_INDEX_POLICY.memoryExperiences,
  },
  memoryIdentities: {
    ...FTS_SEARCH_CURRENT_MAPPINGS.memoryIdentities,
    ...FTS_SEARCH_INDEX_POLICY.memoryIdentities,
  },
  memoryPreferences: {
    ...FTS_SEARCH_CURRENT_MAPPINGS.memoryPreferences,
    ...FTS_SEARCH_INDEX_POLICY.memoryPreferences,
  },
  messages: { ...FTS_SEARCH_CURRENT_MAPPINGS.messages, ...FTS_SEARCH_INDEX_POLICY.messages },
  personaDocuments: {
    ...FTS_SEARCH_CURRENT_MAPPINGS.personaDocuments,
    ...FTS_SEARCH_INDEX_POLICY.personaDocuments,
  },
  topics: { ...FTS_SEARCH_CURRENT_MAPPINGS.topics, ...FTS_SEARCH_INDEX_POLICY.topics },
  userMemories: {
    ...FTS_SEARCH_CURRENT_MAPPINGS.userMemories,
    ...FTS_SEARCH_INDEX_POLICY.userMemories,
  },
} as const satisfies { [Entity in FtsSearchDocumentEntity]: FtsSearchIndexDefinition<Entity> };

/**
 * Generation of the first production rollout, when every entity was built by one reindex run.
 * Generations are per entity now and `getFtsSearchIndexSchemaVersion` is the authoritative value;
 * this constant only identifies that initial checkpoint.
 *
 * @deprecated Use `getFtsSearchIndexSchemaVersion(entity)`.
 */
export const FTS_SEARCH_INDEX_SCHEMA_VERSION = 1;

export const getFtsSearchIndexSchemaVersion = (entity: FtsSearchDocumentEntity): number =>
  FTS_SEARCH_INDEX_DEFINITIONS[entity].schemaVersion;

const toIndexSegment = (entity: FtsSearchDocumentEntity) =>
  entity.replaceAll(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);

/** Namespace is deployment-owned so OSS does not encode environment or tenant policy. */
export const getFtsSearchIndexAlias = (namespace: string, entity: FtsSearchDocumentEntity) =>
  `${namespace}-${toIndexSegment(entity)}`;

export const getFtsSearchPhysicalIndexName = (
  namespace: string,
  entity: FtsSearchDocumentEntity,
  version: number = getFtsSearchIndexSchemaVersion(entity),
) => `${getFtsSearchIndexAlias(namespace, entity)}-v${version}`;

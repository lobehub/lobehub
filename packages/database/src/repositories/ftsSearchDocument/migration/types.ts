export type ElasticsearchFtsSearchFieldType = 'boolean' | 'date' | 'integer' | 'keyword' | 'text';

export interface ElasticsearchFtsSearchMappingProperty {
  analyzer?: string;
  fields?: Record<string, ElasticsearchFtsSearchMappingProperty>;
  ignore_above?: number;
  type: ElasticsearchFtsSearchFieldType;
}

/** Historical fields must remain valid even after they disappear from the current Zod schema. */
export interface FtsSearchMappingSnapshot {
  mappings: {
    dynamic: 'strict';
    properties: Record<string, ElasticsearchFtsSearchMappingProperty>;
  };
  schemaVersion: number;
}

/** A batch contains complete physical definitions for only the entities changed in that batch. */
export interface FtsSearchMappingMigration {
  analysis: Record<string, unknown>;
  definitions: Record<string, FtsSearchMappingSnapshot>;
  /** Global source-history ordinal and description, independent of entity schemaVersion. */
  id: string;
}

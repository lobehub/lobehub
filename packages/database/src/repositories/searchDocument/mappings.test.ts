import { describe, expect, it } from 'vitest';

import {
  getSearchIndexAlias,
  getSearchPhysicalIndexName,
  SEARCH_INDEX_ANALYSIS,
  SEARCH_INDEX_DEFINITIONS,
  SEARCH_INDEX_SCHEMA_VERSION,
} from './mappings';
import { SEARCH_DOCUMENT_ENTITIES, SEARCH_DOCUMENT_SCHEMAS } from './schema';

describe('search index mappings', () => {
  it.each(SEARCH_DOCUMENT_ENTITIES)('matches every %s schema field exactly', (entity) => {
    const schemaFields = Object.keys(SEARCH_DOCUMENT_SCHEMAS[entity].shape).sort();
    const mappingFields = Object.keys(SEARCH_INDEX_DEFINITIONS[entity].mappings.properties).sort();

    expect(mappingFields).toEqual(schemaFields);
    expect(SEARCH_INDEX_DEFINITIONS[entity].mappings.dynamic).toBe('strict');
  });

  it.each(SEARCH_DOCUMENT_ENTITIES)('only queries text fields for %s', (entity) => {
    const definition = SEARCH_INDEX_DEFINITIONS[entity];

    for (const field of definition.queryFields) {
      expect(Object.entries(definition.mappings.properties)).toContainEqual([
        field,
        expect.objectContaining({ type: 'text' }),
      ]);
    }
  });

  it('includes the conversation fields used by the formal Elasticsearch provider', () => {
    expect(SEARCH_INDEX_DEFINITIONS.chatGroups.queryFields).toEqual([
      'title',
      'description',
      'content',
    ]);
    expect(SEARCH_INDEX_DEFINITIONS.messages.queryFields).toEqual(['content', 'summary']);
  });

  it('provides deployment-neutral versioned alias and physical names', () => {
    expect(SEARCH_INDEX_SCHEMA_VERSION).toBe(2);
    expect(getSearchIndexAlias('lobehub-dev', 'knowledgeBases')).toBe(
      'lobehub-dev-knowledge-bases',
    );
    expect(getSearchPhysicalIndexName('lobehub-dev', 'knowledgeBases')).toBe(
      'lobehub-dev-knowledge-bases-v2',
    );
    expect(getSearchPhysicalIndexName('lobehub-dev', 'knowledgeBases', 3)).toBe(
      'lobehub-dev-knowledge-bases-v3',
    );
  });

  it.each(SEARCH_DOCUMENT_ENTITIES)('maps the soft-delete marker for %s', (entity) => {
    expect(SEARCH_INDEX_DEFINITIONS[entity].mappings.properties.search_sync_deleted).toEqual({
      type: 'boolean',
    });
  });

  it('keeps analyzer names generic for OSS deployments', () => {
    expect(Object.keys(SEARCH_INDEX_ANALYSIS.analyzer)).toEqual([
      'lobehub_icu',
      'lobehub_icu_english',
    ]);
  });
});

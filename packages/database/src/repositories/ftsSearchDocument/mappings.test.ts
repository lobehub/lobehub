import { describe, expect, it } from 'vitest';

import { FTS_SEARCH_INDEX_SCHEMA_SNAPSHOTS } from './__tests__/schemaSnapshots';
import { getFtsSearchIndexSchemaFingerprint } from './fingerprint';
import {
  FTS_SEARCH_INDEX_ANALYSIS,
  FTS_SEARCH_INDEX_DEFINITIONS,
  FTS_SEARCH_INDEX_SCHEMA_VERSION,
  getFtsSearchIndexAlias,
  getFtsSearchIndexSchemaVersion,
  getFtsSearchPhysicalIndexName,
} from './mappings';
import { FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS } from './migration';
import { FTS_SEARCH_RETAINED_SOURCE_PROPERTIES } from './policy';
import {
  FTS_SEARCH_DOCUMENT_ENTITIES,
  FTS_SEARCH_DOCUMENT_SCHEMAS,
  FTS_SEARCH_MEMORY_DOCUMENT_ENTITIES,
} from './zodSchema';

describe('search index schema generations', () => {
  it.each(FTS_SEARCH_DOCUMENT_ENTITIES)(
    'bumps the %s schemaVersion whenever its mapping or analysis fingerprint changes',
    (entity) => {
      const actual = {
        fingerprint: getFtsSearchIndexSchemaFingerprint(entity),
        schemaVersion: getFtsSearchIndexSchemaVersion(entity),
      };
      const migrationId = FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS[entity].id;
      const snapshot = FTS_SEARCH_INDEX_SCHEMA_SNAPSHOTS[migrationId]?.[entity];

      expect(
        snapshot,
        `Add the approved ${migrationId}/${entity} schemaVersion and fingerprint to FTS_SEARCH_INDEX_SCHEMA_SNAPSHOTS.`,
      ).toBeDefined();
      expect(actual).toEqual(snapshot);
    },
  );

  it('derives distinct fingerprints from the mapping, not from the entity name', () => {
    expect(getFtsSearchIndexSchemaFingerprint('agents')).not.toBe(
      getFtsSearchIndexSchemaFingerprint('topics'),
    );
    expect(getFtsSearchIndexSchemaFingerprint('agents')).toMatch(/^[\da-f]{64}$/);
  });
});

describe('search index mappings', () => {
  it.each(FTS_SEARCH_DOCUMENT_ENTITIES)('matches every %s schema field exactly', (entity) => {
    const schemaFields = Object.keys(FTS_SEARCH_DOCUMENT_SCHEMAS[entity].shape).sort();
    const mappedFields = Object.keys(FTS_SEARCH_INDEX_DEFINITIONS[entity].mappings.properties);
    const retainedFields = Object.keys(FTS_SEARCH_RETAINED_SOURCE_PROPERTIES[entity]);

    expect(mappedFields.filter((field) => retainedFields.includes(field))).toEqual([]);
    expect([...mappedFields, ...retainedFields].sort()).toEqual(schemaFields);
    expect(FTS_SEARCH_INDEX_DEFINITIONS[entity].mappings.dynamic).toBe('strict');
  });

  it.each(FTS_SEARCH_DOCUMENT_ENTITIES)('only queries text fields for %s', (entity) => {
    const definition = FTS_SEARCH_INDEX_DEFINITIONS[entity];
    const retainedFields = new Set(Object.keys(FTS_SEARCH_RETAINED_SOURCE_PROPERTIES[entity]));

    for (const field of [
      ...('indexedOnlyFields' in definition ? definition.indexedOnlyFields : []),
      ...('longTextFields' in definition ? definition.longTextFields : []),
      ...definition.queryFields,
    ]) {
      expect(retainedFields.has(field)).toBe(false);
    }

    for (const field of definition.queryFields) {
      expect(Object.entries(definition.mappings.properties)).toContainEqual([
        field,
        expect.objectContaining({ type: 'text' }),
      ]);
    }
  });

  it('includes the conversation fields used by the formal Elasticsearch provider', () => {
    expect(FTS_SEARCH_INDEX_DEFINITIONS.chatGroups.queryFields).toEqual([
      'title',
      'description',
      'content',
    ]);
    expect(FTS_SEARCH_INDEX_DEFINITIONS.messages.queryFields).toEqual(['content', 'summary']);
  });

  it('provides deployment-neutral versioned alias and physical names', () => {
    // The first rollout built every entity as v1; later generations move per entity.
    expect(FTS_SEARCH_INDEX_SCHEMA_VERSION).toBe(1);
    expect(getFtsSearchIndexAlias('lobehub-dev', 'knowledgeBases')).toBe(
      'lobehub-dev-knowledge-bases',
    );
    expect(getFtsSearchPhysicalIndexName('lobehub-dev', 'knowledgeBases')).toBe(
      `lobehub-dev-knowledge-bases-v${getFtsSearchIndexSchemaVersion('knowledgeBases')}`,
    );
    expect(getFtsSearchPhysicalIndexName('lobehub-dev', 'knowledgeBases', 4)).toBe(
      'lobehub-dev-knowledge-bases-v4',
    );
  });

  it.each(FTS_SEARCH_DOCUMENT_ENTITIES)('maps the soft-delete marker for %s', (entity) => {
    expect(
      FTS_SEARCH_INDEX_DEFINITIONS[entity].mappings.properties.fts_search_sync_deleted,
    ).toEqual({
      type: 'boolean',
    });
  });

  it('keeps analyzer names generic for OSS deployments', () => {
    expect(Object.keys(FTS_SEARCH_INDEX_ANALYSIS.analyzer)).toEqual([
      'lobehub_cjk_bigram_english',
      'lobehub_filename',
      'lobehub_icu',
      'lobehub_icu_english',
    ]);
  });

  it('splits file names on common separators while preserving an exact field', () => {
    expect(FTS_SEARCH_INDEX_ANALYSIS.tokenizer.lobehub_filename).toEqual({
      tokenize_on_chars: ['whitespace', '-', '_', '/', '.'],
      type: 'char_group',
    });
    expect(FTS_SEARCH_INDEX_DEFINITIONS.files.mappings.properties.name).toEqual({
      analyzer: 'lobehub_filename',
      fields: {
        raw: { ignore_above: 256, type: 'keyword' },
        words: { analyzer: 'lobehub_icu', type: 'text' },
      },
      type: 'text',
    });
  });

  it('bounds exact-match multi-fields so long text cannot fail keyword indexing', () => {
    const rawFields = Object.values(FTS_SEARCH_INDEX_DEFINITIONS).flatMap(({ mappings }) =>
      Object.values(mappings.properties)
        .map(({ fields }) => fields?.raw)
        .filter(Boolean),
    );

    expect(rawFields.length).toBeGreaterThan(0);
    for (const rawField of rawFields) {
      expect(rawField).toEqual(expect.objectContaining({ ignore_above: 256, type: 'keyword' }));
    }
  });

  it('normalizes memory text before generating CJK bigrams', () => {
    expect(FTS_SEARCH_INDEX_ANALYSIS.analyzer.lobehub_cjk_bigram_english.filter).toEqual([
      'english_possessive_stemmer',
      'icu_folding',
      'cjk_bigram',
      'english_stop',
      'english_stemmer',
    ]);

    for (const entity of FTS_SEARCH_MEMORY_DOCUMENT_ENTITIES) {
      const definition = FTS_SEARCH_INDEX_DEFINITIONS[entity];
      for (const field of definition.queryFields) {
        expect(Object.entries(definition.mappings.properties)).toContainEqual([
          field,
          expect.objectContaining({ analyzer: 'lobehub_cjk_bigram_english' }),
        ]);
      }
    }

    expect(FTS_SEARCH_INDEX_DEFINITIONS.documents.mappings.properties.content).toEqual(
      expect.objectContaining({ analyzer: 'lobehub_icu_english' }),
    );
  });
});

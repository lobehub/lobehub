import { describe, expect, it } from 'vitest';

import {
  FTS_SEARCH_INDEX_ANALYSIS,
  FTS_SEARCH_INDEX_DEFINITIONS,
  FTS_SEARCH_INDEX_SCHEMA_VERSION,
  getFtsSearchIndexAlias,
  getFtsSearchPhysicalIndexName,
} from './mappings';
import {
  FTS_SEARCH_DOCUMENT_ENTITIES,
  FTS_SEARCH_DOCUMENT_SCHEMAS,
  FTS_SEARCH_MEMORY_DOCUMENT_ENTITIES,
} from './schema';

describe('search index mappings', () => {
  it.each(FTS_SEARCH_DOCUMENT_ENTITIES)('matches every %s schema field exactly', (entity) => {
    const schemaFields = Object.keys(FTS_SEARCH_DOCUMENT_SCHEMAS[entity].shape).sort();
    const mappingFields = Object.keys(
      FTS_SEARCH_INDEX_DEFINITIONS[entity].mappings.properties,
    ).sort();

    expect(mappingFields).toEqual(schemaFields);
    expect(FTS_SEARCH_INDEX_DEFINITIONS[entity].mappings.dynamic).toBe('strict');
  });

  it.each(FTS_SEARCH_DOCUMENT_ENTITIES)('only queries text fields for %s', (entity) => {
    const definition = FTS_SEARCH_INDEX_DEFINITIONS[entity];

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
    expect(FTS_SEARCH_INDEX_SCHEMA_VERSION).toBe(1);
    expect(getFtsSearchIndexAlias('lobehub-dev', 'knowledgeBases')).toBe(
      'lobehub-dev-knowledge-bases',
    );
    expect(getFtsSearchPhysicalIndexName('lobehub-dev', 'knowledgeBases')).toBe(
      'lobehub-dev-knowledge-bases-v1',
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

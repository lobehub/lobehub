import { describe, expect, it } from 'vitest';

import {
  FTS_SEARCH_INDEX_ANALYSIS,
  FTS_SEARCH_INDEX_DEFINITIONS,
  FTS_SEARCH_INDEX_SCHEMA_HISTORY,
  FTS_SEARCH_INDEX_SCHEMA_VERSION,
  getFtsSearchIndexAlias,
  getFtsSearchIndexMappings,
  getFtsSearchIndexSchemaVersionRecord,
  getFtsSearchPhysicalIndexName,
  parseFtsSearchPhysicalIndexVersion,
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
    expect(FTS_SEARCH_INDEX_SCHEMA_VERSION).toBe(2);
    expect(getFtsSearchIndexAlias('lobehub-dev', 'knowledgeBases')).toBe(
      'lobehub-dev-knowledge-bases',
    );
    expect(getFtsSearchPhysicalIndexName('lobehub-dev', 'knowledgeBases')).toBe(
      'lobehub-dev-knowledge-bases-v2',
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

  describe('getFtsSearchIndexMappings', () => {
    it.each(FTS_SEARCH_DOCUMENT_ENTITIES)(
      'reuses the %s definition dynamic and properties',
      (entity) => {
        const definition = FTS_SEARCH_INDEX_DEFINITIONS[entity];
        const mappings = getFtsSearchIndexMappings(entity);

        expect(mappings.dynamic).toBe('strict');
        expect(mappings.properties).toEqual(definition.mappings.properties);
      },
    );

    it('excludes exactly the sorted long text fields for messages', () => {
      expect(getFtsSearchIndexMappings('messages')._source.excludes).toEqual([
        'content',
        'summary',
      ]);
    });

    it('excludes exactly the sorted long text fields for memoryExperiences', () => {
      expect(getFtsSearchIndexMappings('memoryExperiences')._source.excludes).toEqual([
        'action',
        'key_learning',
        'possible_outcome',
        'reasoning',
        'situation',
      ]);
    });

    it('excludes nothing for files, which has no long text fields', () => {
      expect(getFtsSearchIndexMappings('files')._source.excludes).toEqual([]);
    });

    it.each(FTS_SEARCH_DOCUMENT_ENTITIES)(
      'only excludes fields that exist in the %s mapping properties',
      (entity) => {
        const mappings = getFtsSearchIndexMappings(entity);

        for (const excludedField of mappings._source.excludes) {
          expect(Object.keys(mappings.properties)).toContain(excludedField);
        }
      },
    );
  });

  describe('parseFtsSearchPhysicalIndexVersion', () => {
    it('reads the version suffix off a physical index name for the namespace and entity', () => {
      expect(
        parseFtsSearchPhysicalIndexVersion(
          'lobehub-dev',
          'knowledgeBases',
          'lobehub-dev-knowledge-bases-v2',
        ),
      ).toBe(2);
    });

    it('returns null for a physical index name from a foreign namespace or entity', () => {
      expect(
        parseFtsSearchPhysicalIndexVersion(
          'lobehub-dev',
          'knowledgeBases',
          'other-namespace-knowledge-bases-v2',
        ),
      ).toBeNull();
      expect(
        parseFtsSearchPhysicalIndexVersion(
          'lobehub-dev',
          'knowledgeBases',
          'lobehub-dev-agents-v2',
        ),
      ).toBeNull();
    });

    it('returns null when the version suffix is not purely numeric', () => {
      expect(
        parseFtsSearchPhysicalIndexVersion(
          'lobehub-dev',
          'knowledgeBases',
          'lobehub-dev-knowledge-bases-v2a',
        ),
      ).toBeNull();
    });
  });

  describe('FTS_SEARCH_INDEX_SCHEMA_HISTORY', () => {
    it('is contiguous starting from version 1 and ends at the current schema version', () => {
      expect(FTS_SEARCH_INDEX_SCHEMA_HISTORY.map((record) => record.version)).toEqual(
        Array.from({ length: FTS_SEARCH_INDEX_SCHEMA_HISTORY.length }, (_, index) => index + 1),
      );
      expect(FTS_SEARCH_INDEX_SCHEMA_HISTORY.at(-1)!.version).toBe(FTS_SEARCH_INDEX_SCHEMA_VERSION);
    });

    it('marks only the last entry as current', () => {
      FTS_SEARCH_INDEX_SCHEMA_HISTORY.forEach((record, index) => {
        if (index === FTS_SEARCH_INDEX_SCHEMA_HISTORY.length - 1) {
          expect(record.upgrade).toBe('current');
        } else {
          expect(record.upgrade).not.toBe('current');
        }
      });
    });

    it('only declares a copy upgrade from a version whose _source is complete', () => {
      for (const record of FTS_SEARCH_INDEX_SCHEMA_HISTORY) {
        if (record.upgrade !== 'current' && record.upgrade.strategy === 'copy') {
          expect(record.sourceComplete).toBe(true);
        }
      }
    });

    it('targets the current schema version from every non-current record', () => {
      for (const record of FTS_SEARCH_INDEX_SCHEMA_HISTORY) {
        if (record.upgrade !== 'current') {
          expect(record.upgrade.to).toBe(FTS_SEARCH_INDEX_SCHEMA_VERSION);
        }
      }
    });
  });

  describe('getFtsSearchIndexSchemaVersionRecord', () => {
    it('resolves version 1 to a copy upgrade', () => {
      const record = getFtsSearchIndexSchemaVersionRecord(1);
      expect(record?.upgrade).toEqual({ strategy: 'copy', to: FTS_SEARCH_INDEX_SCHEMA_VERSION });
    });

    it('returns undefined for a version outside the journal', () => {
      expect(getFtsSearchIndexSchemaVersionRecord(0)).toBeUndefined();
    });
  });
});

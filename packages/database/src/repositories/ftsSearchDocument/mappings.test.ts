import { describe, expect, it } from 'vitest';

import { getFtsSearchIndexSchemaFingerprint } from './fingerprint';
import {
  FTS_SEARCH_INDEX_ANALYSIS,
  FTS_SEARCH_INDEX_DEFINITIONS,
  FTS_SEARCH_INDEX_SCHEMA_VERSION,
  getFtsSearchIndexAlias,
  getFtsSearchIndexSchemaVersion,
  getFtsSearchPhysicalIndexName,
} from './mappings';
import {
  FTS_SEARCH_DOCUMENT_ENTITIES,
  FTS_SEARCH_DOCUMENT_SCHEMAS,
  FTS_SEARCH_MEMORY_DOCUMENT_ENTITIES,
} from './schema';

/**
 * Declared generation of every entity index. When a mapping or the shared analysis changes, its
 * fingerprint changes too; the gate below then fails until `schemaVersion` is bumped and this
 * snapshot is updated in the same change, so a live index can never silently drift from the code.
 */
const FTS_SEARCH_INDEX_SCHEMA_SNAPSHOT: Record<
  (typeof FTS_SEARCH_DOCUMENT_ENTITIES)[number],
  { fingerprint: string; schemaVersion: number }
> = {
  agents: {
    fingerprint: '6fd440be1df5ee1437f4a4ec7d22556d1c855ce43bd7fda61ecf0dae32ede233',
    schemaVersion: 1,
  },
  chatGroups: {
    fingerprint: '5b086a9c74ecf70d27334b12cae2de5c5b6412bdc4ad79290514b723b2ec23e2',
    schemaVersion: 1,
  },
  documents: {
    fingerprint: '6d564684eb449d0a70b3c354fa6d9fefe4948cee09d8b46335a7069ac064cde8',
    schemaVersion: 1,
  },
  files: {
    fingerprint: '709e38c13c4684ffc4cb5aec00b4cd276b61a23f0387595bae02466a30291ffc',
    schemaVersion: 1,
  },
  knowledgeBases: {
    fingerprint: 'db6e7e1027953600ca9d5d1147f6138ca6868fcd9c58e30e1ce75d2813027320',
    schemaVersion: 1,
  },
  memoryActivities: {
    fingerprint: 'ea4665bd0026a75719da8580a350245a8deafa85591d36b577e264e84e32d526',
    schemaVersion: 1,
  },
  memoryContexts: {
    fingerprint: '1b9c24a3ab665a84686c766568d976193f670d469fbd29ff30ab2736f3d23b84',
    schemaVersion: 1,
  },
  memoryExperiences: {
    fingerprint: '9748bd7a25f0f53162ad90e3742244e689b4023c863ad71c226b7d0a9763444c',
    schemaVersion: 1,
  },
  memoryIdentities: {
    fingerprint: '491c3b1a096644552e1486cf6862899bd57042df787f01319442d9e615da0c20',
    schemaVersion: 1,
  },
  memoryPreferences: {
    fingerprint: 'e62b555d4548b7f880a6700e0662a3b832a3aa052ad518c869881e1ce99660f7',
    schemaVersion: 1,
  },
  messages: {
    fingerprint: 'c1e0a4ea89bd0c3ad7776287deb05eb82a8d286dc851d112a60c729839bc0d4a',
    schemaVersion: 1,
  },
  personaDocuments: {
    fingerprint: '0e627cf7a6a0ce38ae8b06affc5ad6b30c3c443bf93ae19df743f2b652ec323b',
    schemaVersion: 1,
  },
  topics: {
    fingerprint: '362f4b72197fefee4ffb49298aa134c6da6fba9885e7a23840eb55f053a689b8',
    schemaVersion: 1,
  },
  userMemories: {
    fingerprint: 'df04d074c1f56b5934891b8612b804917c09302a9042015c394216513093d6e9',
    schemaVersion: 1,
  },
};

describe('search index schema generations', () => {
  it.each(FTS_SEARCH_DOCUMENT_ENTITIES)(
    'bumps the %s schemaVersion whenever its mapping or analysis fingerprint changes',
    (entity) => {
      const actual = {
        fingerprint: getFtsSearchIndexSchemaFingerprint(entity),
        schemaVersion: getFtsSearchIndexSchemaVersion(entity),
      };
      const snapshot = FTS_SEARCH_INDEX_SCHEMA_SNAPSHOT[entity];

      if (actual.schemaVersion === snapshot.schemaVersion) {
        expect(
          actual.fingerprint,
          `The ${entity} mapping or shared analysis changed without bumping schemaVersion. Elasticsearch cannot apply this change to the live v${snapshot.schemaVersion} index; bump schemaVersion and refresh FTS_SEARCH_INDEX_SCHEMA_SNAPSHOT in the same change.`,
        ).toBe(snapshot.fingerprint);
        return;
      }

      expect(
        actual.schemaVersion,
        `${entity} schemaVersion must only move forward by one generation per change.`,
      ).toBe(snapshot.schemaVersion + 1);
      expect(
        actual.fingerprint,
        `${entity} schemaVersion was bumped but the mapping fingerprint is unchanged; a new generation must carry a real mapping or analysis change.`,
      ).not.toBe(snapshot.fingerprint);
      expect.fail(
        `${entity} moved to schemaVersion ${actual.schemaVersion}; refresh FTS_SEARCH_INDEX_SCHEMA_SNAPSHOT with fingerprint ${actual.fingerprint}.`,
      );
    },
  );

  it('keeps every entity on the run-level baseline until the reindex run is per-entity', () => {
    for (const entity of FTS_SEARCH_DOCUMENT_ENTITIES) {
      expect(getFtsSearchIndexSchemaVersion(entity)).toBe(FTS_SEARCH_INDEX_SCHEMA_VERSION);
    }
  });

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

import { readdir } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { FTS_SEARCH_INDEX_SCHEMA_SNAPSHOTS } from '../__tests__/schemaSnapshots';
import { sha256Json } from '../fingerprint';
import { FTS_SEARCH_DOCUMENT_ENTITIES } from '../zodSchema';
import {
  FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS,
  FTS_SEARCH_CURRENT_MAPPINGS,
  FTS_SEARCH_INDEX_ANALYSIS,
  FTS_SEARCH_MAPPING_MIGRATIONS,
} from '.';
import type { FtsSearchMappingMigration, FtsSearchMappingSnapshot } from './types';

const getDefinition = (migration: FtsSearchMappingMigration, entity: string) =>
  migration.definitions[entity];

const fingerprintOf = (
  migration: FtsSearchMappingMigration,
  definition: FtsSearchMappingSnapshot,
) =>
  sha256Json({
    analysis: migration.analysis,
    mappings: definition.mappings,
  });

describe('search mapping migration history', () => {
  it('registers every migration directory in source order', async () => {
    const entries = await readdir(__dirname, { withFileTypes: true });
    const directoryIds = entries
      .filter((entry) => entry.isDirectory() && /^\d{4}-/.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    expect(FTS_SEARCH_MAPPING_MIGRATIONS.map(({ id }) => id)).toEqual(directoryIds);
  });

  it.each(FTS_SEARCH_DOCUMENT_ENTITIES)(
    'selects the latest registered mapping for %s',
    (entity) => {
      const migrations = FTS_SEARCH_MAPPING_MIGRATIONS.filter(
        (migration) => entity in migration.definitions,
      );
      const latestMigration = migrations.at(-1);

      expect(latestMigration, `${entity} must have at least one registered mapping`).toBeDefined();
      expect(FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS[entity]).toBe(latestMigration);
      expect(FTS_SEARCH_CURRENT_MAPPINGS[entity]).toBe(
        getDefinition(FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS[entity], entity),
      );
    },
  );

  it.each(FTS_SEARCH_DOCUMENT_ENTITIES)(
    'binds the current %s mapping to the global analysis',
    (entity) => {
      expect(FTS_SEARCH_CURRENT_MAPPING_MIGRATIONS[entity].analysis).toEqual(
        FTS_SEARCH_INDEX_ANALYSIS,
      );
    },
  );

  it('matches every historical definition to its approved fingerprint and version', () => {
    expect(Object.keys(FTS_SEARCH_INDEX_SCHEMA_SNAPSHOTS)).toEqual(
      FTS_SEARCH_MAPPING_MIGRATIONS.map(({ id }) => id),
    );

    for (const migration of FTS_SEARCH_MAPPING_MIGRATIONS) {
      const definitions = migration.definitions;
      const snapshots = FTS_SEARCH_INDEX_SCHEMA_SNAPSHOTS[migration.id];

      expect(
        snapshots,
        `Add an approved schema snapshot for migration ${migration.id}.`,
      ).toBeDefined();
      expect(Object.keys(snapshots ?? {}).sort()).toEqual(Object.keys(definitions).sort());

      for (const [entity, definition] of Object.entries(definitions)) {
        expect(snapshots?.[entity]).toEqual({
          fingerprint: fingerprintOf(migration, definition),
          schemaVersion: definition.schemaVersion,
        });
      }
    }
  });

  it.each(FTS_SEARCH_DOCUMENT_ENTITIES)(
    'increments %s versions only when the physical fingerprint changes',
    (entity) => {
      const history = FTS_SEARCH_MAPPING_MIGRATIONS.flatMap((migration) => {
        const definition = getDefinition(migration, entity);
        return definition
          ? [{ definition, fingerprint: fingerprintOf(migration, definition) }]
          : [];
      });

      for (let index = 1; index < history.length; index++) {
        const previous = history[index - 1];
        const current = history[index];

        expect(current.definition.schemaVersion).toBe(previous.definition.schemaVersion + 1);
        expect(current.fingerprint).not.toBe(previous.fingerprint);
      }
    },
  );
});

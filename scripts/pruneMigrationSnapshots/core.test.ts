import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { pruneMigrationSnapshots } from './core';

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

const createMetaDir = (files: string[]) => {
  const root = mkdtempSync(path.join(tmpdir(), 'prune-migration-snapshots-'));
  testRoots.push(root);
  for (const file of files) writeFileSync(path.join(root, file), '{}');
  return root;
};

describe('pruneMigrationSnapshots', () => {
  it('keeps the newest snapshots by migration index and leaves the journal alone', () => {
    const metaDir = createMetaDir([
      '_journal.json',
      '0098_snapshot.json',
      '0099_snapshot.json',
      '0100_snapshot.json',
      '0101_snapshot.json',
    ]);

    const removed = pruneMigrationSnapshots(metaDir, 2);

    expect(removed).toEqual(['0098_snapshot.json', '0099_snapshot.json']);
    expect(readdirSync(metaDir).sort()).toEqual([
      '0100_snapshot.json',
      '0101_snapshot.json',
      '_journal.json',
    ]);
  });

  it('does nothing when there are no more snapshots than the keep count', () => {
    const metaDir = createMetaDir(['_journal.json', '0000_snapshot.json']);

    expect(pruneMigrationSnapshots(metaDir, 10)).toEqual([]);
    expect(existsSync(path.join(metaDir, '0000_snapshot.json'))).toBe(true);
  });

  it('rejects a keep count that would delete the latest snapshot', () => {
    const metaDir = createMetaDir(['0000_snapshot.json']);

    expect(() => pruneMigrationSnapshots(metaDir, 0)).toThrow();
    expect(existsSync(path.join(metaDir, '0000_snapshot.json'))).toBe(true);
  });
});

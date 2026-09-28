import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { checkFtsMappingHistory } from './check-fts-mapping-history.mjs';

const execFileAsync = promisify(execFile);
const migrationRoot = 'packages/database/src/repositories/ftsSearchDocument/migration';
const snapshotsPath =
  'packages/database/src/repositories/ftsSearchDocument/__tests__/schemaSnapshots.json';

const git = async (repoRoot, args) => {
  const { stdout } = await execFileAsync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  return stdout.trim();
};

const writeRepoFile = async (repoRoot, relativePath, contents) => {
  const filePath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
};

const writeSnapshots = async (repoRoot, snapshots) =>
  writeRepoFile(repoRoot, snapshotsPath, `${JSON.stringify(snapshots, null, 2)}\n`);

const commit = async (repoRoot, message) => {
  await git(repoRoot, ['add', '--all']);
  await git(repoRoot, ['commit', '-q', '-m', message]);
  return git(repoRoot, ['rev-parse', 'HEAD']);
};

const addMigration = async (repoRoot, migrationId, marker = migrationId) => {
  await writeRepoFile(
    repoRoot,
    `${migrationRoot}/${migrationId}/mapping.ts`,
    `export const marker = '${marker}';\n`,
  );
  await writeRepoFile(
    repoRoot,
    `${migrationRoot}/${migrationId}/fields.ts`,
    `export const field = '${marker}';\n`,
  );
};

const createRepository = async (t, { withInitialMigration = true, withSnapshots = true } = {}) => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'fts-mapping-history-'));
  t.after(() => rm(repoRoot, { force: true, recursive: true }));

  await git(repoRoot, ['init', '-q']);
  await git(repoRoot, ['config', 'user.email', 'test@example.com']);
  await git(repoRoot, ['config', 'user.name', 'Test']);

  if (withInitialMigration) {
    await addMigration(repoRoot, '0000-initial');
    if (withSnapshots) {
      await writeSnapshots(repoRoot, {
        '0000-initial': { messages: { fingerprint: 'initial', schemaVersion: 1 } },
      });
    }
  } else {
    await writeRepoFile(repoRoot, 'README.md', 'bootstrap\n');
  }

  const baseRevision = await commit(repoRoot, 'base');
  return { baseRevision, repoRoot };
};

test('allows the first migration catalog to bootstrap when the base has none', async (t) => {
  const { baseRevision, repoRoot } = await createRepository(t, { withInitialMigration: false });
  await addMigration(repoRoot, '0000-initial');
  await writeSnapshots(repoRoot, {
    '0000-initial': { messages: { fingerprint: 'initial', schemaVersion: 1 } },
  });
  await commit(repoRoot, 'bootstrap catalog');

  const result = await checkFtsMappingHistory({ baseRevision, repoRoot });

  assert.deepEqual(result, {
    newMigrationIds: ['0000-initial'],
    newSnapshotIds: ['0000-initial'],
  });
});

test('allows JSON snapshots to bootstrap for frozen migrations when the base file is absent', async (t) => {
  const { baseRevision, repoRoot } = await createRepository(t, { withSnapshots: false });
  await writeSnapshots(repoRoot, {
    '0000-initial': { messages: { fingerprint: 'initial', schemaVersion: 1 } },
  });
  await commit(repoRoot, 'bootstrap snapshots');

  const result = await checkFtsMappingHistory({ baseRevision, repoRoot });

  assert.deepEqual(result, {
    newMigrationIds: [],
    newSnapshotIds: ['0000-initial'],
  });
});

test('does not bootstrap frozen migrations when the base already has a snapshot file', async (t) => {
  const { repoRoot } = await createRepository(t, { withSnapshots: false });
  await writeSnapshots(repoRoot, {});
  const emptySnapshotRevision = await commit(repoRoot, 'publish empty snapshots');
  await writeSnapshots(repoRoot, {
    '0000-initial': { messages: { fingerprint: 'initial', schemaVersion: 1 } },
  });
  await commit(repoRoot, 'backfill published snapshots');

  await assert.rejects(
    checkFtsMappingHistory({ baseRevision: emptySnapshotRevision, repoRoot }),
    /new snapshot batch 0000-initial has no new migration directory/,
  );
});

test('allows higher migration ordinals with matching snapshot batches', async (t) => {
  const { baseRevision, repoRoot } = await createRepository(t);
  await addMigration(repoRoot, '0001-add-language');
  await writeSnapshots(repoRoot, {
    '0000-initial': { messages: { fingerprint: 'initial', schemaVersion: 1 } },
    '0001-add-language': { messages: { fingerprint: 'language', schemaVersion: 2 } },
  });
  await commit(repoRoot, 'append migration');

  const result = await checkFtsMappingHistory({ baseRevision, repoRoot });

  assert.deepEqual(result.newMigrationIds, ['0001-add-language']);
});

test('rejects changes and additions inside a published migration directory', async (t) => {
  const { baseRevision, repoRoot } = await createRepository(t);
  await writeRepoFile(
    repoRoot,
    `${migrationRoot}/0000-initial/mapping.ts`,
    "export const marker = 'changed';\n",
  );
  await writeRepoFile(repoRoot, `${migrationRoot}/0000-initial/analysis.ts`, 'export {};\n');
  await commit(repoRoot, 'change published migration');

  await assert.rejects(
    checkFtsMappingHistory({ baseRevision, repoRoot }),
    /published migration directory 0000-initial changed/,
  );
});

test('rejects deleting or renaming a published migration directory', async (t) => {
  const { baseRevision, repoRoot } = await createRepository(t);
  await rename(
    path.join(repoRoot, migrationRoot, '0000-initial'),
    path.join(repoRoot, migrationRoot, '0001-renamed'),
  );
  await writeSnapshots(repoRoot, {
    '0001-renamed': { messages: { fingerprint: 'initial', schemaVersion: 1 } },
  });
  await commit(repoRoot, 'rename published migration');

  await assert.rejects(
    checkFtsMappingHistory({ baseRevision, repoRoot }),
    /published migration directory 0000-initial was deleted or renamed/,
  );
});

test('rejects modifying a published snapshot batch, including adding an entity', async (t) => {
  const { baseRevision, repoRoot } = await createRepository(t);
  await writeSnapshots(repoRoot, {
    '0000-initial': {
      messages: { fingerprint: 'changed', schemaVersion: 1 },
      topics: { fingerprint: 'added', schemaVersion: 1 },
    },
  });
  await commit(repoRoot, 'change published snapshots');

  await assert.rejects(
    checkFtsMappingHistory({ baseRevision, repoRoot }),
    /published snapshot batch 0000-initial changed/,
  );
});

test('rejects reused ordinals and snapshots without matching migration directories', async (t) => {
  const { baseRevision, repoRoot } = await createRepository(t);
  await addMigration(repoRoot, '0000-second');
  await addMigration(repoRoot, 'missing-ordinal');
  await writeSnapshots(repoRoot, {
    '0000-initial': { messages: { fingerprint: 'initial', schemaVersion: 1 } },
    '0000-second': { messages: { fingerprint: 'second', schemaVersion: 2 } },
    '0001-orphan': { topics: { fingerprint: 'orphan', schemaVersion: 1 } },
  });
  await commit(repoRoot, 'reuse ordinal');

  await assert.rejects(checkFtsMappingHistory({ baseRevision, repoRoot }), (error) => {
    assert.match(error.message, /new migration 0000-second must use an ordinal greater than 0000/);
    assert.match(error.message, /new migration directory missing-ordinal must start/);
    assert.match(error.message, /migration ordinal is duplicated/);
    assert.match(error.message, /new snapshot batch 0001-orphan has no new migration directory/);
    return true;
  });
});

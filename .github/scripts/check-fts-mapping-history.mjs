import { execFile } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MIGRATION_ROOT = 'packages/database/src/repositories/ftsSearchDocument/migration';
const SNAPSHOTS_PATH =
  'packages/database/src/repositories/ftsSearchDocument/__tests__/schemaSnapshots.json';
const MIGRATION_ID_PATTERN = /^(\d{4})-.+/;

export class FtsMappingHistoryError extends Error {
  constructor(violations) {
    super(
      `FTS mapping history is not append-only:\n${violations.map((item) => `- ${item}`).join('\n')}`,
    );
    this.name = 'FtsMappingHistoryError';
    this.violations = violations;
  }
}

const git = async (repoRoot, args) => {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return stdout.trim();
};

const gitObjectExists = async (repoRoot, object) => {
  try {
    await git(repoRoot, ['cat-file', '-e', object]);
    return true;
  } catch {
    return false;
  }
};

const assertCommitExists = async (repoRoot, revision) => {
  if (!(await gitObjectExists(repoRoot, `${revision}^{commit}`))) {
    throw new Error(`Git revision ${revision} is not available as a commit`);
  }
};

const listMigrationDirectories = async (repoRoot, revision) => {
  if (!(await gitObjectExists(repoRoot, `${revision}:${MIGRATION_ROOT}`))) return [];

  const output = await git(repoRoot, [
    'ls-tree',
    '-d',
    '--name-only',
    `${revision}:${MIGRATION_ROOT}`,
  ]);

  return output.split('\n').filter(Boolean).sort();
};

const readSnapshots = async (repoRoot, revision) => {
  if (!(await gitObjectExists(repoRoot, `${revision}:${SNAPSHOTS_PATH}`))) {
    return { exists: false, value: {} };
  }

  const source = await git(repoRoot, ['show', `${revision}:${SNAPSHOTS_PATH}`]);
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`${SNAPSHOTS_PATH} is not valid JSON at ${revision}: ${error.message}`, {
      cause: error,
    });
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${SNAPSHOTS_PATH} must contain a JSON object at ${revision}`);
  }

  return { exists: true, value };
};

const ordinalOf = (migrationId) => Number.parseInt(MIGRATION_ID_PATTERN.exec(migrationId)[1], 10);

const findDuplicateOrdinals = (migrationIds) => {
  const idsByOrdinal = new Map();
  for (const migrationId of migrationIds) {
    const ordinal = ordinalOf(migrationId);
    idsByOrdinal.set(ordinal, [...(idsByOrdinal.get(ordinal) ?? []), migrationId]);
  }

  return [...idsByOrdinal.values()].filter((ids) => ids.length > 1);
};

export const checkFtsMappingHistory = async ({ baseRevision, headRevision = 'HEAD', repoRoot }) => {
  await Promise.all([
    assertCommitExists(repoRoot, baseRevision),
    assertCommitExists(repoRoot, headRevision),
  ]);

  const [baseDirectories, headDirectories, baseSnapshotState, headSnapshotState] =
    await Promise.all([
      listMigrationDirectories(repoRoot, baseRevision),
      listMigrationDirectories(repoRoot, headRevision),
      readSnapshots(repoRoot, baseRevision),
      readSnapshots(repoRoot, headRevision),
    ]);

  const violations = [];
  const baseSnapshots = baseSnapshotState.value;
  const headSnapshots = headSnapshotState.value;
  const baseMigrationIds = baseDirectories.filter((entry) => MIGRATION_ID_PATTERN.test(entry));
  const headMigrationIds = headDirectories.filter((entry) => MIGRATION_ID_PATTERN.test(entry));
  const baseDirectorySet = new Set(baseDirectories);

  for (const directory of headDirectories) {
    if (!baseDirectorySet.has(directory) && !MIGRATION_ID_PATTERN.test(directory)) {
      violations.push(
        `new migration directory ${directory} must start with a unique four-digit ordinal`,
      );
    }
  }

  const headMigrationIdSet = new Set(headMigrationIds);
  const baseMigrationIdSet = new Set(baseMigrationIds);

  for (const migrationId of baseMigrationIds) {
    if (!headMigrationIdSet.has(migrationId)) {
      violations.push(`published migration directory ${migrationId} was deleted or renamed`);
      continue;
    }

    const changes = await git(repoRoot, [
      'diff',
      '--name-status',
      baseRevision,
      headRevision,
      '--',
      `${MIGRATION_ROOT}/${migrationId}`,
    ]);
    if (changes) {
      violations.push(
        `published migration directory ${migrationId} changed:\n  ${changes.replaceAll('\n', '\n  ')}`,
      );
    }
  }

  const newMigrationIds = headMigrationIds.filter((id) => !baseMigrationIdSet.has(id));
  const maximumBaseOrdinal = Math.max(-1, ...baseMigrationIds.map(ordinalOf));

  for (const migrationId of newMigrationIds) {
    if (ordinalOf(migrationId) <= maximumBaseOrdinal) {
      violations.push(
        `new migration ${migrationId} must use an ordinal greater than ${String(maximumBaseOrdinal).padStart(4, '0')}`,
      );
    }
  }

  for (const duplicateIds of findDuplicateOrdinals(headMigrationIds)) {
    violations.push(`migration ordinal is duplicated by ${duplicateIds.join(', ')}`);
  }

  for (const [migrationId, snapshot] of Object.entries(baseSnapshots)) {
    if (!Object.hasOwn(headSnapshots, migrationId)) {
      violations.push(`published snapshot batch ${migrationId} was deleted or renamed`);
    } else if (!isDeepStrictEqual(headSnapshots[migrationId], snapshot)) {
      violations.push(`published snapshot batch ${migrationId} changed`);
    }
  }

  const baseSnapshotIds = new Set(Object.keys(baseSnapshots));
  const newSnapshotIds = Object.keys(headSnapshots).filter((id) => !baseSnapshotIds.has(id));
  const newMigrationIdSet = new Set(newMigrationIds);
  const newSnapshotIdSet = new Set(newSnapshotIds);

  for (const migrationId of newMigrationIds) {
    if (!newSnapshotIdSet.has(migrationId)) {
      violations.push(`new migration ${migrationId} has no new snapshot batch`);
    }
  }
  for (const snapshotId of newSnapshotIds) {
    const bootstrapsFrozenMigration =
      !baseSnapshotState.exists && baseMigrationIdSet.has(snapshotId);
    if (!newMigrationIdSet.has(snapshotId) && !bootstrapsFrozenMigration) {
      violations.push(`new snapshot batch ${snapshotId} has no new migration directory`);
    }
  }

  if (violations.length > 0) throw new FtsMappingHistoryError(violations);

  return { newMigrationIds, newSnapshotIds };
};

const isDirectRun =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const [baseRevision, headRevision = 'HEAD'] = process.argv.slice(2);
  if (!baseRevision) {
    console.error('Usage: node check-fts-mapping-history.mjs <base-revision> [head-revision]');
    process.exitCode = 2;
  } else {
    try {
      const result = await checkFtsMappingHistory({
        baseRevision,
        headRevision,
        repoRoot: process.cwd(),
      });
      console.log(
        `FTS mapping history is append-only (${result.newMigrationIds.length} new migration batch(es)).`,
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}

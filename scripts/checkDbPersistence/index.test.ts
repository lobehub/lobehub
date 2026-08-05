import { describe, expect, it } from 'vitest';

import { type DbSnapshot, diffSnapshots } from './index';

const baseSnapshot = (): DbSnapshot => ({
  capturedAt: '2026-08-05T00:00:00.000Z',
  database: {
    database: 'lobechat',
    driver: 'node',
    host: 'localhost',
    port: '5432',
    urlFingerprint: 'abc123',
  },
  docker: {
    postgresContainer: 'running',
    postgresDataDirBytes: 1000,
    postgresDataDirExists: true,
  },
  migrations: {
    applied: 137,
    latestHash: 'hash-137',
  },
  users: {
    count: 2,
    fingerprint: 'users-fp',
    rows: [
      {
        createdAt: '2026-08-05T07:22:05.126Z',
        email: 'a@example.com',
        id: 'user_a',
      },
    ],
  },
});

describe('diffSnapshots', () => {
  it('reports no diffs when snapshots match', () => {
    const snapshot = baseSnapshot();
    expect(diffSnapshots(snapshot, { ...snapshot })).toEqual([]);
  });

  it('detects user count and fingerprint changes', () => {
    const before = baseSnapshot();
    const after = {
      ...before,
      users: {
        ...before.users,
        count: 0,
        fingerprint: 'empty',
        rows: [],
      },
    };

    const diffs = diffSnapshots(before, after);
    expect(diffs.map((diff) => diff.field)).toEqual(
      expect.arrayContaining(['users.count', 'users.fingerprint']),
    );
  });

  it('detects database target changes', () => {
    const before = baseSnapshot();
    const after = {
      ...before,
      database: {
        ...before.database,
        database: 'postgres',
        urlFingerprint: 'other-db',
      },
    };

    const diffs = diffSnapshots(before, after);
    expect(diffs.map((diff) => diff.field)).toEqual(
      expect.arrayContaining(['database.database', 'database.urlFingerprint']),
    );
  });
});

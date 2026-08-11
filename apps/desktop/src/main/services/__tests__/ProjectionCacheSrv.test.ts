import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { DesktopProjectionCommit } from '@lobechat/electron-client-ipc';
import { DESKTOP_PROJECTION_CACHE_TABLES } from '@lobechat/electron-client-ipc';
import superjson from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import LocalDatabaseService from '../LocalDatabaseSrv';
import ProjectionCacheService from '../ProjectionCacheSrv';

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn() }),
}));

const fragment = (data: Record<string, unknown>, observedAt: number) => ({
  data: superjson.stringify(data),
  observedAt,
  source: 'network' as const,
});

describe('ProjectionCacheService', () => {
  let localDatabase: LocalDatabaseService;
  let projectionCache: ProjectionCacheService;
  let storagePath: string;

  beforeEach(async () => {
    storagePath = await mkdtemp(path.join(os.tmpdir(), 'lobehub-projection-cache-'));
    const app = {
      appStoragePath: storagePath,
      getService: (serviceClass: unknown) => {
        if (serviceClass === LocalDatabaseService) return localDatabase;
        if (serviceClass === ProjectionCacheService) return projectionCache;
        throw new Error('Unexpected service');
      },
    } as unknown as App;
    localDatabase = new LocalDatabaseService(app);
    projectionCache = new ProjectionCacheService(app);
  });

  afterEach(async () => {
    localDatabase.destroy();
    await rm(storagePath, { force: true, recursive: true });
  });

  it('atomically persists and hydrates every entity table, Home index, and snapshot', async () => {
    const scope = 'user-1:personal';
    const commit: DesktopProjectionCommit = {
      indexes: [
        {
          data: superjson.stringify({ refs: [] }),
          key: 'home.inboxTopics',
          observedAt: 6,
          source: 'network',
        },
      ],
      records: [
        {
          fragments: { identity: fragment({ title: 'Agent' }, 1) },
          id: 'agent-1',
          kind: 'agent',
        },
        {
          fragments: { readState: fragment({ readAt: null }, 5) },
          id: 'brief-1',
          kind: 'brief',
        },
        {
          fragments: { identity: fragment({ title: 'Group' }, 2) },
          id: 'group-1',
          kind: 'chatGroup',
        },
        {
          fragments: { lifecycle: fragment({ status: 'todo' }, 4) },
          id: 'task-1',
          kind: 'task',
        },
        {
          fragments: {
            activity: fragment({ updatedAt: new Date('2026-08-11T00:00:00.000Z') }, 3),
          },
          id: 'topic-1',
          kind: 'topic',
        },
      ],
      scope,
      snapshots: [
        {
          data: superjson.stringify({ pairs: [{ hint: 'Hint', welcome: 'Welcome' }] }),
          key: 'home.dailyBrief',
          observedAt: 7,
          source: 'network',
        },
      ],
    };

    await projectionCache.commit(commit);

    await expect(projectionCache.hydrateScope(scope)).resolves.toEqual({
      indexes: commit.indexes,
      records: commit.records,
      snapshots: commit.snapshots,
    });
    await expect(projectionCache.listCollections()).resolves.toEqual(
      expect.arrayContaining([
        { entryCount: 1, name: DESKTOP_PROJECTION_CACHE_TABLES.agent },
        { entryCount: 1, name: DESKTOP_PROJECTION_CACHE_TABLES.brief },
        { entryCount: 1, name: DESKTOP_PROJECTION_CACHE_TABLES.chatGroup },
        { entryCount: 1, name: DESKTOP_PROJECTION_CACHE_TABLES.homeIndexes },
        { entryCount: 1, name: DESKTOP_PROJECTION_CACHE_TABLES.homeSnapshots },
        { entryCount: 1, name: DESKTOP_PROJECTION_CACHE_TABLES.task },
        { entryCount: 1, name: DESKTOP_PROJECTION_CACHE_TABLES.topic },
      ]),
    );

    const [entry] = await projectionCache.inspectEntries(DESKTOP_PROJECTION_CACHE_TABLES.topic, '');
    const inspected = superjson.parse<{
      scope: string;
      value: { fragments: { activity: { data: { updatedAt: Date } } } };
    }>(entry.value);
    expect(inspected.scope).toBe(scope);
    expect(inspected.value.fragments.activity.data.updatedAt).toBeInstanceOf(Date);
  });

  it('rejects unknown Fragment columns before starting the durable transaction', async () => {
    await expect(
      projectionCache.commit({
        records: [
          {
            fragments: { unknown: fragment({ value: true }, 1) },
            id: 'topic-1',
            kind: 'topic',
          },
        ],
        scope: 'user-1:personal',
      }),
    ).rejects.toThrow('Unsupported topic fragment: unknown');

    await expect(projectionCache.hydrateScope('user-1:personal')).resolves.toEqual({
      indexes: [],
      records: [],
      snapshots: [],
    });
  });

  it('enforces complete Fragment triples at the SQLite boundary', () => {
    const database = localDatabase.getRuntime().database;

    expect(() =>
      database
        .prepare(
          `INSERT INTO projection_agents
            (storage_id, scope, entity_id, access_data)
           VALUES (?, ?, ?, ?)`,
        )
        .run('scope::agent-1', 'scope', 'agent-1', superjson.stringify({ userId: 'u1' })),
    ).toThrow();
  });

  it('clears one scope across all typed tables without affecting another scope', async () => {
    const commitFor = (scope: string): DesktopProjectionCommit => ({
      records: [
        {
          fragments: { identity: fragment({ title: scope }, 1) },
          id: 'agent-1',
          kind: 'agent',
        },
      ],
      scope,
    });
    await projectionCache.commit(commitFor('scope-1'));
    await projectionCache.commit(commitFor('scope-2'));

    await projectionCache.clearScope('scope-1');

    await expect(projectionCache.hydrateScope('scope-1')).resolves.toEqual({
      indexes: [],
      records: [],
      snapshots: [],
    });
    await expect(projectionCache.hydrateScope('scope-2')).resolves.toMatchObject({
      records: [{ id: 'agent-1' }],
    });
  });

  it('serializes Projection transactions behind other writers on the shared SQLite connection', async () => {
    let releaseWriter!: () => void;
    let markWriterStarted!: () => void;
    const writerStarted = new Promise<void>((resolve) => {
      markWriterStarted = resolve;
    });
    const writerMayFinish = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const blockingWrite = localDatabase.runWrite(async () => {
      markWriterStarted();
      await writerMayFinish;
    });
    await writerStarted;

    const projectionWrite = projectionCache.commit({
      records: [
        {
          fragments: { identity: fragment({ title: 'Queued' }, 1) },
          id: 'agent-1',
          kind: 'agent',
        },
      ],
      scope: 'scope',
    });
    await Promise.resolve();

    const database = localDatabase.getRuntime().database;
    expect(database.prepare('SELECT COUNT(*) AS count FROM projection_agents').get()).toEqual({
      count: 0,
    });

    releaseWriter();
    await Promise.all([blockingWrite, projectionWrite]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM projection_agents').get()).toEqual({
      count: 1,
    });
  });
});

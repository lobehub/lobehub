import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  DesktopProjectionCommit,
  DesktopProjectionHydrationRequest,
} from '@lobechat/electron-client-ipc';
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
          data: superjson.stringify({ refs: [{ id: 'agent-1', kind: 'agent' }], signature: {} }),
          key: 'agent.directory',
          observedAt: 6,
          source: 'network',
        },
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

    const hydrationRequest: DesktopProjectionHydrationRequest = {
      indexes: ['agent.directory', 'home.inboxTopics'],
      records: [
        { fragments: ['identity'], ids: ['agent-1'], kind: 'agent' },
        { fragments: ['readState'], ids: ['brief-1'], kind: 'brief' },
        { fragments: ['identity'], ids: ['group-1'], kind: 'chatGroup' },
        { fragments: ['lifecycle'], ids: ['task-1'], kind: 'task' },
        { fragments: ['activity'], ids: ['topic-1'], kind: 'topic' },
      ],
      scope,
      snapshots: ['home.dailyBrief'],
    };

    await expect(projectionCache.hydrate(hydrationRequest)).resolves.toEqual({
      indexes: commit.indexes,
      records: commit.records,
      snapshots: commit.snapshots,
      timing: { databaseReadMs: expect.any(Number) },
    });
    await expect(projectionCache.listCollections()).resolves.toEqual(
      expect.arrayContaining([
        { entryCount: 1, name: DESKTOP_PROJECTION_CACHE_TABLES.agent },
        { entryCount: 1, name: DESKTOP_PROJECTION_CACHE_TABLES.brief },
        { entryCount: 1, name: DESKTOP_PROJECTION_CACHE_TABLES.chatGroup },
        { entryCount: 2, name: DESKTOP_PROJECTION_CACHE_TABLES.indexes },
        { entryCount: 1, name: DESKTOP_PROJECTION_CACHE_TABLES.snapshots },
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

  it('hydrates only a declared View Contract and resolves Task route identifiers', async () => {
    const scope = 'user-1:personal';
    await projectionCache.commit({
      indexes: [
        {
          data: superjson.stringify({ refs: [{ id: 'topic-1', kind: 'topic' }] }),
          key: 'home.inboxTopics',
          observedAt: 5,
          source: 'network',
        },
        {
          data: superjson.stringify({ refs: [{ id: 'agent-1', kind: 'agent' }] }),
          key: 'agent.directory',
          observedAt: 5,
          source: 'network',
        },
      ],
      records: [
        {
          fragments: {
            display: fragment({ title: 'Requested' }, 2),
            status: fragment({ status: 'running' }, 3),
          },
          id: 'topic-1',
          kind: 'topic',
        },
        {
          fragments: { display: fragment({ title: 'Not requested' }, 2) },
          id: 'topic-2',
          kind: 'topic',
        },
        {
          fragments: {
            detail: fragment({ id: 'task-db-1', instruction: 'Cached detail' }, 4),
            identity: fragment({ identifier: 'T-1' }, 4),
          },
          id: 'task-db-1',
          kind: 'task',
        },
      ],
      scope,
      snapshots: [
        {
          data: superjson.stringify({ pairs: [{ hint: 'Hint', welcome: 'Welcome' }] }),
          key: 'home.dailyBrief',
          observedAt: 6,
          source: 'network',
        },
      ],
    });

    const hydrated = await projectionCache.hydrate({
      indexes: ['home.inboxTopics'],
      records: [
        { fragments: ['display'], ids: ['topic-1'], kind: 'topic' },
        { fragments: ['detail', 'identity'], ids: ['T-1'], kind: 'task' },
      ],
      scope,
    });

    expect(hydrated.indexes).toHaveLength(1);
    expect(hydrated.timing?.databaseReadMs).toBeGreaterThanOrEqual(0);
    expect(hydrated.indexes[0].key).toBe('home.inboxTopics');
    expect(hydrated.snapshots).toEqual([]);
    expect(hydrated.records).toEqual([
      {
        fragments: {
          detail: fragment({ id: 'task-db-1', instruction: 'Cached detail' }, 4),
          identity: fragment({ identifier: 'T-1' }, 4),
        },
        id: 'task-db-1',
        kind: 'task',
      },
      {
        fragments: { display: fragment({ title: 'Requested' }, 2) },
        id: 'topic-1',
        kind: 'topic',
      },
    ]);
  });

  it('merges partial renderer commits without erasing newer persisted Fragments', async () => {
    const scope = 'user-1:personal';

    await projectionCache.commit({
      records: [
        {
          fragments: { display: fragment({ title: 'Current title' }, 200) },
          id: 'topic-1',
          kind: 'topic',
        },
      ],
      scope,
    });
    await projectionCache.commit({
      records: [
        {
          fragments: { status: fragment({ status: 'running' }, 300) },
          id: 'topic-1',
          kind: 'topic',
        },
      ],
      scope,
    });
    await projectionCache.commit({
      records: [
        {
          fragments: { display: fragment({ title: 'Stale title' }, 100) },
          id: 'topic-1',
          kind: 'topic',
        },
      ],
      scope,
    });

    await expect(
      projectionCache.hydrate({
        records: [{ fragments: ['display', 'status'], ids: ['topic-1'], kind: 'topic' }],
        scope,
      }),
    ).resolves.toMatchObject({
      records: [
        {
          fragments: {
            display: fragment({ title: 'Current title' }, 200),
            status: fragment({ status: 'running' }, 300),
          },
          id: 'topic-1',
          kind: 'topic',
        },
      ],
    });
  });

  it('retains a persisted tombstone as a barrier after a newer Fragment revives a record', async () => {
    const scope = 'user-1:personal';
    await projectionCache.commit({
      records: [{ fragments: {}, id: 'topic-1', kind: 'topic', tombstoneAt: 200 }],
      scope,
    });
    await projectionCache.commit({
      records: [
        {
          fragments: { display: fragment({ title: 'Revived title' }, 300) },
          id: 'topic-1',
          kind: 'topic',
        },
      ],
      scope,
    });
    await projectionCache.commit({
      records: [
        {
          fragments: { display: fragment({ title: 'Pre-delete title' }, 100) },
          id: 'topic-1',
          kind: 'topic',
        },
      ],
      scope,
    });

    await expect(
      projectionCache.hydrate({
        records: [{ fragments: ['display'], ids: ['topic-1'], kind: 'topic' }],
        scope,
      }),
    ).resolves.toMatchObject({
      records: [
        {
          fragments: { display: fragment({ title: 'Revived title' }, 300) },
          id: 'topic-1',
          kind: 'topic',
          tombstoneAt: 200,
        },
      ],
    });
  });

  it('persists the scheduled-task Home index', async () => {
    const scope = 'user-1:personal';
    const index = {
      data: superjson.stringify({ refs: [{ id: 'task-1', kind: 'task' }] }),
      key: 'home.scheduledTasks' as const,
      observedAt: 10,
      source: 'network' as const,
    };

    await projectionCache.commit({ indexes: [index], scope });

    await expect(projectionCache.hydrate({ indexes: [index.key], scope })).resolves.toMatchObject({
      indexes: [index],
    });
  });

  it('uses the shared key grammar at the Main-process boundary', async () => {
    const scope = 'user-1:personal';
    await projectionCache.commit({
      indexes: [
        {
          data: superjson.stringify({ refs: [], signature: {} }),
          key: 'agent.search:',
          observedAt: 1,
          source: 'network',
        },
      ],
      scope,
    });

    await expect(
      projectionCache.commit({
        indexes: [
          {
            data: superjson.stringify({ persistRefLimit: 20, refs: [], signature: {}, total: 0 }),
            key: 'chat.sidebarTopics:',
            observedAt: 2,
            source: 'network',
          },
        ],
        scope,
      } as DesktopProjectionCommit),
    ).rejects.toThrow('Unsupported Projection index: chat.sidebarTopics:');

    await expect(
      projectionCache.hydrate({ indexes: ['agent.search:'], scope }),
    ).resolves.toMatchObject({ indexes: [expect.objectContaining({ key: 'agent.search:' })] });
  });

  it('collects unreferenced records when a persisted Home index is replaced', async () => {
    const scope = 'user-1:personal';
    const indexedCommit = (id: string, observedAt: number): DesktopProjectionCommit => ({
      indexes: [
        {
          data: superjson.stringify({ refs: [{ id, kind: 'topic' }] }),
          key: 'home.inboxTopics',
          observedAt,
          source: 'network',
        },
      ],
      records: [
        {
          fragments: { display: fragment({ title: id }, observedAt) },
          id,
          kind: 'topic',
        },
      ],
      scope,
    });
    await projectionCache.commit(indexedCommit('topic-old', 1));

    await projectionCache.commit(indexedCommit('topic-current', 2));

    await expect(projectionCache.listCollections()).resolves.toEqual(
      expect.arrayContaining([{ entryCount: 1, name: DESKTOP_PROJECTION_CACHE_TABLES.topic }]),
    );
    await expect(
      projectionCache.hydrate({
        records: [
          {
            fragments: ['display'],
            ids: ['topic-old', 'topic-current'],
            kind: 'topic',
          },
        ],
        scope,
      }),
    ).resolves.toMatchObject({ records: [expect.objectContaining({ id: 'topic-current' })] });
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
      } as unknown as DesktopProjectionCommit),
    ).rejects.toThrow('Unsupported topic fragment: unknown');

    await expect(
      projectionCache.hydrate({
        records: [{ fragments: ['display'], ids: ['topic-1'], kind: 'topic' }],
        scope: 'user-1:personal',
      }),
    ).resolves.toEqual({
      indexes: [],
      records: [],
      snapshots: [],
      timing: { databaseReadMs: expect.any(Number) },
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

  it('keeps business key registration outside the SQLite schema', () => {
    const database = localDatabase.getRuntime().database;

    expect(() =>
      database
        .prepare(
          `INSERT INTO projection_indexes
            (storage_id, scope, key, data, observed_at, source)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'scope::future.index',
          'scope',
          'future.index',
          superjson.stringify({ refs: [] }),
          1,
          'network',
        ),
    ).not.toThrow();
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

    await expect(
      projectionCache.hydrate({
        records: [{ fragments: ['identity'], ids: ['agent-1'], kind: 'agent' }],
        scope: 'scope-1',
      }),
    ).resolves.toEqual({
      indexes: [],
      records: [],
      snapshots: [],
      timing: { databaseReadMs: expect.any(Number) },
    });
    await expect(
      projectionCache.hydrate({
        records: [{ fragments: ['identity'], ids: ['agent-1'], kind: 'agent' }],
        scope: 'scope-2',
      }),
    ).resolves.toMatchObject({
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

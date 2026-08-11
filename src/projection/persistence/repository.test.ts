import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  localDatabase,
  type LocalDatabaseAdapter,
  type LocalDatabaseBatchOperation,
  type LocalDatabaseEntry,
  registerLocalDatabaseAdapter,
} from '@/libs/localDatabase';

import {
  createProjectionRepository,
  parseProjectionStorageKey,
  PROJECTION_COLLECTIONS,
  PROJECTION_SCHEMA_VERSION,
  projectionStorageKeys,
} from './repository';

interface TestProjectionRecord {
  id: string;
  kind: 'thing';
  updatedAt?: Date;
  value: string;
}

interface TestIndex {
  key: 'things';
  refs: string[];
}

interface TestSnapshot {
  data: string;
  key: 'summary';
}

class MemoryLocalDatabaseAdapter implements LocalDatabaseAdapter {
  readonly data = new Map<string, Map<string, unknown>>();

  private collection(name: string): Map<string, unknown> {
    const existing = this.data.get(name);
    if (existing) return existing;
    const created = new Map<string, unknown>();
    this.data.set(name, created);
    return created;
  }

  async batch(operations: LocalDatabaseBatchOperation[]): Promise<void> {
    for (const operation of operations) {
      if (operation.type === 'set') {
        this.collection(operation.collection).set(operation.key, structuredClone(operation.value));
      } else {
        this.collection(operation.collection).delete(operation.key);
      }
    }
  }

  async delete(collection: string, key: string): Promise<void> {
    this.collection(collection).delete(key);
  }

  async deleteByPrefix(collection: string, prefix: string): Promise<void> {
    const values = this.collection(collection);
    for (const key of values.keys()) if (key.startsWith(prefix)) values.delete(key);
  }

  async entriesByPrefix<T>(collection: string, prefix: string): Promise<LocalDatabaseEntry<T>[]> {
    return Array.from(this.collection(collection).entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value: value as T }));
  }

  async get<T>(collection: string, key: string): Promise<T | undefined> {
    return this.collection(collection).get(key) as T | undefined;
  }

  async initialize(): Promise<void> {}

  async listCollections() {
    return [...this.data.entries()]
      .filter(([, entries]) => entries.size > 0)
      .map(([name, entries]) => ({ entryCount: entries.size, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async set(collection: string, key: string, value: unknown): Promise<void> {
    this.collection(collection).set(key, value);
  }
}

const repository = createProjectionRepository<TestProjectionRecord, TestIndex, TestSnapshot>({
  isRecord: (value): value is TestProjectionRecord =>
    Boolean(value) &&
    typeof value === 'object' &&
    (value as TestProjectionRecord).kind === 'thing' &&
    typeof (value as TestProjectionRecord).id === 'string' &&
    typeof (value as TestProjectionRecord).value === 'string' &&
    ((value as TestProjectionRecord).updatedAt === undefined ||
      (value as TestProjectionRecord).updatedAt instanceof Date),
  isIndex: (value): value is TestIndex =>
    Boolean(value) &&
    typeof value === 'object' &&
    (value as TestIndex).key === 'things' &&
    Array.isArray((value as TestIndex).refs),
  isSnapshot: (value): value is TestSnapshot =>
    Boolean(value) &&
    typeof value === 'object' &&
    (value as TestSnapshot).key === 'summary' &&
    typeof (value as TestSnapshot).data === 'string',
});

describe('createProjectionRepository', () => {
  let adapter: MemoryLocalDatabaseAdapter;
  let unregister: () => void;

  beforeEach(() => {
    adapter = new MemoryLocalDatabaseAdapter();
    unregister = registerLocalDatabaseAdapter(adapter);
  });

  afterEach(() => {
    unregister();
    vi.restoreAllMocks();
  });

  it('persists one logical Projection commit as one durable batch', async () => {
    const batch = vi.spyOn(adapter, 'batch');
    const record: TestProjectionRecord = { id: '1', kind: 'thing', value: 'Projection' };
    const index: TestIndex = { key: 'things', refs: ['1'] };
    const snapshot: TestSnapshot = { data: 'Summary', key: 'summary' };

    await repository.commit('user-1:workspace-1', {
      records: [record],
      indexes: [index],
      snapshots: [snapshot],
    });

    expect(batch).toHaveBeenCalledTimes(1);
    await expect(repository.hydrateScope('user-1:workspace-1')).resolves.toEqual({
      records: [record],
      indexes: [index],
      snapshots: [snapshot],
    });
  });

  it('preserves durable commit order within one scope', async () => {
    const applyBatch = adapter.batch.bind(adapter);
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let callCount = 0;
    const batch = vi.spyOn(adapter, 'batch').mockImplementation(async (operations) => {
      callCount += 1;
      if (callCount === 1) await firstMayFinish;
      await applyBatch(operations);
    });

    const first = repository.commit('user-1:workspace-1', {
      records: [{ id: '1', kind: 'thing', value: 'Older' }],
    });
    await Promise.resolve();
    const second = repository.commit('user-1:workspace-1', {
      records: [{ id: '1', kind: 'thing', value: 'Newer' }],
    });
    await Promise.resolve();

    expect(batch).toHaveBeenCalledTimes(1);
    releaseFirst();
    await Promise.all([first, second]);

    await expect(repository.hydrateScope('user-1:workspace-1')).resolves.toMatchObject({
      records: [{ value: 'Newer' }],
    });
  });

  it('isolates identical identities across persisted scopes', async () => {
    await repository.commit('user-1:workspace-1', {
      records: [{ id: '1', kind: 'thing', value: 'Workspace One' }],
    });
    await repository.commit('user-1:workspace-2', {
      records: [{ id: '1', kind: 'thing', value: 'Workspace Two' }],
    });

    await expect(repository.hydrateScope('user-1:workspace-1')).resolves.toMatchObject({
      records: [{ value: 'Workspace One' }],
    });
    await expect(repository.hydrateScope('user-1:workspace-2')).resolves.toMatchObject({
      records: [{ value: 'Workspace Two' }],
    });
  });

  it('round-trips structured values without JSON degradation', async () => {
    const updatedAt = new Date('2026-07-31T00:00:00.000Z');
    await repository.commit('user-1:personal', {
      records: [{ id: '1', kind: 'thing', updatedAt, value: 'Dated projection' }],
    });

    const hydrated = await repository.hydrateScope('user-1:personal');
    expect(hydrated.records[0].updatedAt).toBeInstanceOf(Date);
    expect(hydrated.records[0].updatedAt).toEqual(updatedAt);
  });

  it('ignores incompatible or invalid persisted envelopes during hydration', async () => {
    const scope = 'user-1:workspace-1';
    await localDatabase.set(
      PROJECTION_COLLECTIONS.records,
      projectionStorageKeys.record(scope, 'thing', 'old'),
      {
        schemaVersion: PROJECTION_SCHEMA_VERSION + 1,
        value: { id: 'old', kind: 'thing', value: 'Old schema' },
      },
    );
    await localDatabase.set(
      PROJECTION_COLLECTIONS.records,
      projectionStorageKeys.record(scope, 'thing', 'invalid'),
      {
        schemaVersion: PROJECTION_SCHEMA_VERSION,
        value: { id: 'invalid', kind: 'thing' },
      },
    );

    await expect(repository.hydrateScope(scope)).resolves.toEqual({
      records: [],
      indexes: [],
      snapshots: [],
    });
  });
});

describe('Projection storage keys', () => {
  it('round-trips Projection identities containing delimiter-like and unicode text', () => {
    const key = projectionStorageKeys.record('user::工作区', 'topic', 'topic::1/草稿');

    expect(parseProjectionStorageKey(key)).toEqual({
      id: 'topic::1/草稿',
      kind: 'topic',
      scope: 'user::工作区',
    });
  });

  it('rejects malformed or incomplete Projection storage keys', () => {
    expect(parseProjectionStorageKey('scope::topic')).toBeUndefined();
    expect(parseProjectionStorageKey('scope::topic::%E0%A4%A')).toBeUndefined();
  });
});

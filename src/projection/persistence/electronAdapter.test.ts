import type { DesktopProjectionCommit } from '@lobechat/electron-client-ipc';
import type { ProjectionHydrationRequest } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectionBootSpanNames } from '@/libs/bootMetrics/spanNames';
import { bootTiming } from '@/libs/bootTiming';

import { createElectronProjectionPersistence } from './electronAdapter';

const mocks = vi.hoisted(() => ({
  clearScope: vi.fn(),
  commit: vi.fn(),
  hydrate: vi.fn(),
}));

vi.mock('@/utils/electron/ipc', () => ({
  ensureElectronIpc: () => ({ projectionCache: mocks }),
}));

const scope = 'user-1:personal';
const materializedCommit = {
  indexes: [],
  records: [
    {
      fragments: {
        activity: {
          data: { updatedAt: new Date('2026-08-11T00:00:00.000Z') },
          observedAt: 1,
          source: 'network' as const,
        },
      },
      id: 'topic-1',
      kind: 'topic' as const,
    },
  ],
  snapshots: [],
};

describe('createElectronProjectionPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bootTiming._reset();
    mocks.clearScope.mockResolvedValue(undefined);
    mocks.commit.mockResolvedValue(undefined);
    mocks.hydrate.mockResolvedValue({ indexes: [], records: [], snapshots: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the dedicated entity-cache IPC and preserves structured fragment values', async () => {
    const persistence = createElectronProjectionPersistence();
    await persistence.commit(scope, materializedCommit);

    const payload = mocks.commit.mock.calls[0][0] as DesktopProjectionCommit;
    expect(payload.scope).toBe(scope);
    expect(payload.records?.[0]).toMatchObject({ id: 'topic-1', kind: 'topic' });

    mocks.hydrate.mockResolvedValue({
      indexes: [],
      records: payload.records,
      snapshots: [],
    });
    const request: ProjectionHydrationRequest = {
      records: [{ fragments: ['activity'], ids: ['topic-1'], kind: 'topic' }],
    };
    const hydrated = await persistence.hydrate(scope, request);
    expect(hydrated.records[0]).toEqual(materializedCommit.records[0]);
    const hydratedTopic = hydrated.records[0];
    if (hydratedTopic.kind !== 'topic') throw new Error('Expected a Topic Projection');
    expect(hydratedTopic.fragments.activity?.data.updatedAt).toBeInstanceOf(Date);
    expect(mocks.hydrate).toHaveBeenCalledWith({ ...request, scope });

    await persistence.clearScope(scope);
    expect(mocks.clearScope).toHaveBeenCalledWith({ scope });
  });

  it('serializes commits within one scope so a slower older write cannot finish last', async () => {
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mocks.commit.mockImplementationOnce(() => firstMayFinish).mockResolvedValueOnce(undefined);
    const persistence = createElectronProjectionPersistence();

    const first = persistence.commit(scope, materializedCommit);
    await Promise.resolve();
    const second = persistence.commit(scope, {
      ...materializedCommit,
      records: [
        {
          ...materializedCommit.records[0],
          fragments: {
            display: { data: { title: 'Newer' }, observedAt: 2, source: 'mutation' },
          },
        },
      ],
    });
    await Promise.resolve();

    expect(mocks.commit).toHaveBeenCalledTimes(1);
    releaseFirst();
    await Promise.all([first, second]);
    expect(mocks.commit).toHaveBeenCalledTimes(2);
  });

  it('attributes a slow round trip to the process that was actually busy', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1500);
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(600)
      .mockReturnValueOnce(602)
      .mockReturnValueOnce(608);
    mocks.hydrate.mockResolvedValue({
      indexes: [],
      records: [],
      snapshots: [],
      // Main took 20ms of the 500ms round trip; the renderer sat on the reply
      // for 460ms after main had already answered.
      timing: { completedAt: 1040, databaseReadMs: 18, receivedAt: 1020 },
    });
    const persistence = createElectronProjectionPersistence();

    await persistence.hydrate(scope, { indexes: ['home.sidebar'] });

    expect(bootTiming.snapshot().spans).toEqual([
      { durMs: 500, name: projectionBootSpanNames.ipcRoundtrip, startMs: 100 },
      { durMs: 20, name: projectionBootSpanNames.ipcInbound, startMs: 100 },
      { durMs: 20, name: projectionBootSpanNames.mainWork, startMs: 120 },
      { durMs: 460, name: projectionBootSpanNames.ipcDelivery, startMs: 140 },
      { durMs: 18, name: projectionBootSpanNames.databaseRead, startMs: 122 },
      { durMs: 6, name: projectionBootSpanNames.decode, startMs: 602 },
    ]);
  });

  it('reads without waiting for a pending commit on the same scope', async () => {
    let releaseCommit!: () => void;
    mocks.commit.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseCommit = resolve;
        }),
    );
    const persistence = createElectronProjectionPersistence();

    const commit = persistence.commit(scope, materializedCommit);
    await Promise.resolve();
    const hydrated = await persistence.hydrate(scope, { indexes: ['home.sidebar'] });

    expect(hydrated).toEqual({ indexes: [], records: [], snapshots: [] });
    releaseCommit();
    await commit;
  });
});

import type { DesktopProjectionCommit } from '@lobechat/electron-client-ipc';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createElectronProjectionPersistence } from './electronAdapter';

const mocks = vi.hoisted(() => ({
  clearScope: vi.fn(),
  commit: vi.fn(),
  hydrateScope: vi.fn(),
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
    mocks.clearScope.mockResolvedValue(undefined);
    mocks.commit.mockResolvedValue(undefined);
    mocks.hydrateScope.mockResolvedValue({ indexes: [], records: [], snapshots: [] });
  });

  it('uses the dedicated entity-cache IPC and preserves structured fragment values', async () => {
    const persistence = createElectronProjectionPersistence();
    await persistence.commit(scope, materializedCommit);

    const payload = mocks.commit.mock.calls[0][0] as DesktopProjectionCommit;
    expect(payload.scope).toBe(scope);
    expect(payload.records?.[0]).toMatchObject({ id: 'topic-1', kind: 'topic' });

    mocks.hydrateScope.mockResolvedValue({
      indexes: [],
      records: payload.records,
      snapshots: [],
    });
    const hydrated = await persistence.hydrateScope(scope);
    expect(hydrated.records[0]).toEqual(materializedCommit.records[0]);
    const hydratedTopic = hydrated.records[0];
    if (hydratedTopic.kind !== 'topic') throw new Error('Expected a Topic Projection');
    expect(hydratedTopic.fragments.activity?.data.updatedAt).toBeInstanceOf(Date);

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
});

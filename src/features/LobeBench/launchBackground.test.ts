import { describe, expect, it, vi } from 'vitest';

import {
  createExperimentLaunch,
  experimentLaunchKey,
  type LaunchServices,
  type LaunchStorage,
} from './experimentLaunch';
import {
  backgroundLaunchKey,
  findSavedExperimentLaunch,
  forgetExperimentLaunch,
  getBackgroundLaunch,
  startBackgroundLaunch,
  subscribeBackgroundLaunch,
} from './launchBackground';

const setup = () => {
  const record = createExperimentLaunch({
    benchmarkId: 'b',
    datasetId: 'd',
    name: 'Trial',
    metadata: {},
    contenders: [{ id: 'm', name: 'Model', config: {} }],
  });
  const scope = { benchmarkId: 'b', userId: 'u', workspaceId: null };
  const data = new Map([[experimentLaunchKey(scope), JSON.stringify(record)]]);
  const storage: LaunchStorage = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const services: LaunchServices = {
    createExperiment: vi.fn(async () => ({})),
    listRuns: vi.fn(async () => []),
    createRun: vi.fn(async () => {
      await gate;
      return { status: 'idle' };
    }),
    updateExperiment: vi.fn(async () => ({})),
    startRun: vi.fn(async () => ({})),
  };
  return {
    record,
    scope,
    storage,
    services,
    release,
    key: backgroundLaunchKey('u', null, record.experimentId),
  };
};
describe('route-independent experiment launch', () => {
  it('continues after the page unsubscribes and exposes completion on return', async () => {
    const f = setup();
    const listener = vi.fn();
    const unsubscribe = subscribeBackgroundLaunch(listener);
    const task = startBackgroundLaunch(f.scope, f.record, f.services, f.storage);
    await vi.waitFor(() => expect(f.services.createRun).toHaveBeenCalledOnce());
    expect(getBackgroundLaunch(f.key)?.progress?.stage).toBe('run');
    unsubscribe();
    listener.mockClear();
    f.release();
    await task;
    expect(listener).not.toHaveBeenCalled();
    expect(getBackgroundLaunch(f.key)?.outcome?.complete).toBe(true);
    expect(f.services.startRun).toHaveBeenCalledOnce();
    expect(f.storage.getItem(experimentLaunchKey(f.scope))).toBeNull();
  });
  it('deduplicates a second start while the route changes', async () => {
    const f = setup();
    const task = startBackgroundLaunch(f.scope, f.record, f.services, f.storage);
    expect(startBackgroundLaunch(f.scope, f.record, f.services, f.storage)).toBe(task);
    f.release();
    await task;
    expect(f.services.startRun).toHaveBeenCalledOnce();
    expect(
      getBackgroundLaunch(backgroundLaunchKey('other', null, f.record.experimentId)),
    ).toBeUndefined();
  });
  it('retains the error and checkpoint for a retry after navigating away', async () => {
    const f = setup();
    vi.mocked(f.services.createRun).mockRejectedValueOnce(new Error('Connection unavailable'));
    const result = await startBackgroundLaunch(f.scope, f.record, f.services, f.storage);
    expect(result.complete).toBe(false);
    expect(getBackgroundLaunch(f.key)?.active).toBe(false);
    expect(getBackgroundLaunch(f.key)?.outcome?.error?.message).toBe('Connection unavailable');
    expect(f.storage.getItem(experimentLaunchKey(f.scope))).not.toBeNull();
    f.release();
    expect((await startBackgroundLaunch(f.scope, f.record, f.services, f.storage)).complete).toBe(
      true,
    );
  });
});

describe('deleted launch recovery', () => {
  it('removes only the deleted experiment checkpoint and retained failed state', async () => {
    const f = setup();
    vi.mocked(f.services.createRun).mockRejectedValueOnce(new Error('offline'));
    await startBackgroundLaunch(f.scope, f.record, f.services, f.storage);
    const ownKey = experimentLaunchKey(f.scope);
    const otherKey = experimentLaunchKey({ ...f.scope, userId: 'other' });
    localStorage.setItem(ownKey, JSON.stringify(f.record));
    localStorage.setItem(otherKey, JSON.stringify(f.record));
    expect(findSavedExperimentLaunch('u', null, f.record.experimentId)?.experimentId).toBe(
      f.record.experimentId,
    );
    expect(
      findSavedExperimentLaunch('u', 'different-workspace', f.record.experimentId),
    ).toBeUndefined();
    forgetExperimentLaunch('u', null, f.record.experimentId);
    expect(getBackgroundLaunch(f.key)).toBeUndefined();
    expect(localStorage.getItem(ownKey)).toBeNull();
    expect(localStorage.getItem(otherKey)).not.toBeNull();
    localStorage.removeItem(otherKey);
  });
});

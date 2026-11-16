// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deviceRouter } from '../device';

const mocks = vi.hoisted(() => ({ countInFlightInDirectory: vi.fn(), topicModelArgs: vi.fn() }));

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(() => ({})) }));
vi.mock('@/database/models/device', () => ({ DeviceModel: class {} }));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    constructor(...args: unknown[]) {
      mocks.topicModelArgs(...args);
    }
    countInFlightInDirectory = mocks.countInFlightInDirectory;
  },
}));

describe('device.countRunningTopicsInDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countInFlightInDirectory.mockResolvedValue(2);
  });

  it('returns only the count for the directory on that device', async () => {
    const caller = deviceRouter.createCaller({ userId: 'user' } as never);

    await expect(
      caller.countRunningTopicsInDirectory({ deviceId: 'dev-1', path: '/code/lobehub' }),
    ).resolves.toBe(2);
    expect(mocks.countInFlightInDirectory).toHaveBeenCalledWith({
      deviceId: 'dev-1',
      path: '/code/lobehub',
    });
    // Personal mode: scoped to the caller, no workspace.
    expect(mocks.topicModelArgs).toHaveBeenCalledWith(expect.anything(), 'user', undefined);
  });
});

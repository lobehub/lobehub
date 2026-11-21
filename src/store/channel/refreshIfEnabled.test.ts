import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { refreshChannelListIfEnabled } from './refreshIfEnabled';

const mocks = vi.hoisted(() => ({
  enableChannels: false as boolean | undefined,
  refreshList: vi.fn(),
}));

vi.mock('@/store/serverConfig', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getServerConfigStoreState: () => ({ featureFlags: { enableChannels: mocks.enableChannels } }),
}));

vi.mock('@/store/channel', () => ({ channelActions: { refreshList: mocks.refreshList } }));

describe('refreshChannelListIfEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enableChannels = false;
  });

  it.each([false, undefined])(
    'leaves the Channel list alone while Channels are %s',
    async (flag) => {
      mocks.enableChannels = flag;
      refreshChannelListIfEnabled();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mocks.refreshList).not.toHaveBeenCalled();
    },
  );

  it('refetches the Channel list while Channels are on', async () => {
    mocks.enableChannels = true;
    mocks.refreshList.mockResolvedValue(undefined);
    refreshChannelListIfEnabled();
    await waitFor(() => expect(mocks.refreshList).toHaveBeenCalledTimes(1));
  });

  it('logs a failed refetch instead of throwing into the caller', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.enableChannels = true;
    mocks.refreshList.mockRejectedValue(new Error('offline'));
    expect(() => refreshChannelListIfEnabled()).not.toThrow();
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.any(String), expect.any(Error)));
    error.mockRestore();
  });
});

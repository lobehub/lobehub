// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelHistoryService } from './ChannelHistoryService';

const getFlags = vi.hoisted(() => vi.fn());
vi.mock('@/server/featureFlags', () => ({ getServerFeatureFlagsStateFromRuntimeConfig: getFlags }));

const readMessages = vi.hoisted(() => vi.fn());
const readMessage = vi.hoisted(() => vi.fn());
vi.mock('@/database/repositories/channel', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChannelHistoryRepository: vi.fn(function () {
    return { readMessage, readMessages };
  }),
}));

describe('Channel history behind the `channel` flag', () => {
  const history = new ChannelHistoryService({} as any, 'user-1', 'op-1');

  beforeEach(() => {
    vi.clearAllMocks();
    readMessages.mockResolvedValue({ cutoffSequence: 1, messages: [], nextBeforeSequence: null });
  });

  it('refuses Agent history reads while the flag is off for the requester', async () => {
    getFlags.mockResolvedValue({ enableChannels: false });
    await expect(history.readMessages({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(history.readMessage({ messageId: 'message' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(getFlags).toHaveBeenCalledWith('user-1');
    expect(readMessages).not.toHaveBeenCalled();
    expect(readMessage).not.toHaveBeenCalled();
  });

  it('reads once the flag is on', async () => {
    getFlags.mockResolvedValue({ enableChannels: true });
    await expect(history.readMessages({})).resolves.toMatchObject({ cutoffSequence: 1 });
  });
});

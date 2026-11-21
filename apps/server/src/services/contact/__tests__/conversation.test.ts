// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ChannelService, openPeer } = vi.hoisted(() => {
  const openPeer = vi.fn();
  return {
    ChannelService: vi.fn(function () {
      return { openPeer };
    }),
    openPeer,
  };
});

vi.mock('@/server/services/channel/ChannelService', () => ({ ChannelService }));

const { openContactConversation } = await import('../conversation');

const db = {} as any;

describe('openContactConversation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens it as the requester in the request scope', async () => {
    await openContactConversation({ addresseeId: 'b', db, requesterId: 'a', workspaceId: 'ws' });
    expect(ChannelService).toHaveBeenCalledWith(db, 'a', 'ws');
    expect(openPeer).toHaveBeenCalledWith('b');
  });

  it('opens it in the personal space without a workspace', async () => {
    await openContactConversation({ addresseeId: 'b', db, requesterId: 'a', workspaceId: null });
    expect(ChannelService).toHaveBeenCalledWith(db, 'a', undefined);
  });

  it('never fails the acceptance', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    openPeer.mockRejectedValue(new Error('You are not contacts'));
    await expect(
      openContactConversation({ addresseeId: 'b', db, requesterId: 'a', workspaceId: null }),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});

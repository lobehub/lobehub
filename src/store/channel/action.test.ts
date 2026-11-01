import { beforeEach, describe, expect, it, vi } from 'vitest';

import { channelActions } from './action';

vi.mock('@/services/channel', () => ({
  channelService: {
    addAgent: vi.fn(),
    addUser: vi.fn(),
    create: vi.fn(),
    createGroupFromDirect: vi.fn(),
    detail: vi.fn(),
    list: vi.fn(),
    send: vi.fn(),
  },
}));

const { channelService } = await import('@/services/channel');

describe('channelActions after a committed write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    channelActions.reset();
  });

  // A refresh failure read as a create failure, so the retry created a second Channel.
  it('reports a created Channel even when the list refresh fails', async () => {
    vi.mocked(channelService.create).mockResolvedValue({
      data: { channel: { id: 'chn_000000000001' } },
    } as never);
    vi.mocked(channelService.list).mockRejectedValue(new Error('offline'));

    await expect(channelActions.create({ agents: [], title: 'Team' })).resolves.toBe(
      'chn_000000000001',
    );
    expect(channelService.create).toHaveBeenCalledTimes(1);
  });

  it('opens the group started from a direct conversation even when the list refresh fails', async () => {
    vi.mocked(channelService.createGroupFromDirect).mockResolvedValue({
      data: { channel: { id: 'chn_000000000002' } },
    } as never);
    vi.mocked(channelService.list).mockRejectedValue(new Error('offline'));
    const input = {
      agents: [],
      channelId: 'chn_000000000001',
      title: 'Ada, Mia',
      userIds: ['user-mia'],
    };

    await expect(channelActions.createGroupFromDirect(input)).resolves.toBe('chn_000000000002');
    expect(channelService.createGroupFromDirect).toHaveBeenCalledExactlyOnceWith(input);
    expect(channelService.list).toHaveBeenCalled();
  });

  it('settles added members even when the detail refresh fails', async () => {
    vi.mocked(channelService.addAgent).mockResolvedValue({} as never);
    vi.mocked(channelService.detail).mockRejectedValue(new Error('offline'));

    await expect(
      channelActions.addMembers('chn_000000000001', {
        agents: [{ agentId: 'agt_a' }, { agentId: 'agt_b' }],
      }),
    ).resolves.toBeUndefined();
  });

  it('still reports a failed add', async () => {
    vi.mocked(channelService.addAgent)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('device offline'));
    vi.mocked(channelService.detail).mockRejectedValue(new Error('offline'));

    await expect(
      channelActions.addMembers('chn_000000000001', {
        agents: [{ agentId: 'agt_a' }, { agentId: 'agt_b' }],
      }),
    ).rejects.toThrow('device offline');
  });

  // One invite adds people and Agents together; people go first so a failing Agent
  // cannot block the people who were already chosen.
  it('adds invited people before Agents and refreshes once', async () => {
    vi.mocked(channelService.addUser).mockResolvedValue({} as never);
    vi.mocked(channelService.addAgent).mockResolvedValue({} as never);
    vi.mocked(channelService.detail).mockResolvedValue({} as never);

    await channelActions.addMembers('chn_000000000001', {
      agents: [{ agentId: 'agt_a' }],
      userIds: ['user_b', 'user_c'],
    });

    expect(vi.mocked(channelService.addUser).mock.calls.map(([, userId]) => userId)).toEqual([
      'user_b',
      'user_c',
    ]);
    expect(vi.mocked(channelService.addUser).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(channelService.addAgent).mock.invocationCallOrder[0],
    );
    expect(channelService.detail).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  notifyChannel: vi.fn(),
  projectChannelIds: vi.fn(),
}));

vi.mock('@/database/repositories/channel', () => ({
  projectChannelIds: mocks.projectChannelIds,
  removeAgentFromProjectChannels: vi.fn(),
}));
vi.mock('./notify', () => ({ notifyChannel: mocks.notifyChannel }));
vi.mock('./queue', () => ({ wakeChannel: vi.fn() }));
vi.mock('./ChannelCoordinator', () => ({ ChannelCoordinator: vi.fn() }));

const { deleteProjectKeepingChannels } = await import('./projectMembership');

const db = {} as never;

describe('deleteProjectKeepingChannels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls.length = 0;
    mocks.projectChannelIds.mockImplementation(async () => {
      mocks.calls.push('read');
      return ['chn_a', 'chn_b'];
    });
    mocks.notifyChannel.mockImplementation(async (_db: unknown, channelId: string) => {
      mocks.calls.push(`notify:${channelId}`);
    });
  });

  it("tells every member of the project's Channels once the project is deleted", async () => {
    const remove = vi.fn(async () => {
      mocks.calls.push('delete');
      return { id: 'pro_1' };
    });

    await expect(deleteProjectKeepingChannels(db, 'pro_1', remove)).resolves.toEqual({
      id: 'pro_1',
    });

    expect(mocks.projectChannelIds).toHaveBeenCalledWith(db, 'pro_1');
    // The Channels are read while still linked to the project; members hear after the delete.
    expect(mocks.calls[0]).toBe('read');
    expect(mocks.calls[1]).toBe('delete');
    expect(mocks.calls.slice(2).toSorted()).toEqual(['notify:chn_a', 'notify:chn_b']);
  });

  it('notifies no one when nothing was deleted', async () => {
    await expect(deleteProjectKeepingChannels(db, 'pro_1', async () => null)).resolves.toBeNull();

    expect(mocks.notifyChannel).not.toHaveBeenCalled();
  });
});

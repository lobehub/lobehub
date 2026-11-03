import type { ChannelListItem } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { channelActions } from './action';
import { useChannelStore } from './store';

vi.mock('@/services/channel', () => ({
  channelService: { list: vi.fn(), openDirect: vi.fn() },
}));

const { channelService } = await import('@/services/channel');

const direct = (patch: Partial<ChannelListItem>) =>
  ({ agentId: 'agt_nasa', id: 'chn_000000000001', projectId: null, ...patch }) as ChannelListItem;

describe('channelActions.openDirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    channelActions.reset();
    vi.mocked(channelService.list).mockResolvedValue([]);
  });

  it('reuses the listed direct Channel without asking the server', async () => {
    useChannelStore.setState({
      listMap: { all: [direct({ agentId: null, id: 'chn_group00000001' }), direct({})] },
    });

    await expect(channelActions.openDirect('agt_nasa')).resolves.toBe('chn_000000000001');
    expect(channelService.openDirect).not.toHaveBeenCalled();
  });

  it('ignores a project Channel bound to the same Agent', async () => {
    useChannelStore.setState({ listMap: { all: [direct({ projectId: 'pro_1' })] } });
    vi.mocked(channelService.openDirect).mockResolvedValue('chn_000000000002');

    await expect(channelActions.openDirect('agt_nasa')).resolves.toBe('chn_000000000002');
  });

  it('opens one for an Agent made before direct Channels, then refreshes the list', async () => {
    vi.mocked(channelService.openDirect).mockResolvedValue('chn_000000000002');

    await expect(channelActions.openDirect('agt_nasa')).resolves.toBe('chn_000000000002');
    expect(channelService.openDirect).toHaveBeenCalledExactlyOnceWith({
      agentId: 'agt_nasa',
      localDeviceId: undefined,
    });
    expect(channelService.list).toHaveBeenCalled();
  });

  it('reports no Channel when the Agent cannot answer in one', async () => {
    vi.mocked(channelService.openDirect).mockResolvedValue(null);

    await expect(channelActions.openDirect('agt_nasa')).resolves.toBeUndefined();
    expect(channelService.list).not.toHaveBeenCalled();
  });
});

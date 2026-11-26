// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelError } from '@/database/repositories/channel';

import { ChannelService } from './ChannelService';

const { detail, readShareVisitorChannel } = vi.hoisted(() => ({
  detail: vi.fn(),
  readShareVisitorChannel: vi.fn(),
}));
vi.mock('@/database/repositories/channel', async (original) => ({
  ...(await original<object>()),
  ChannelRepository: class {
    detail = detail;
  },
}));
vi.mock('@/database/repositories/channel/shareVisitors', () => ({
  listShareVisitorConversations: vi.fn(),
  readShareVisitorChannel,
}));
vi.mock('@/database/models/project', () => ({ ProjectModel: class {} }));
vi.mock('@/database/models/device', () => ({ DeviceModel: class {} }));
vi.mock('@/server/services/agent', () => ({ AgentService: class {} }));
vi.mock('@/server/services/file', () => ({ FileService: class {} }));
vi.mock('./ChannelCoordinator', () => ({ ChannelCoordinator: class {} }));
vi.mock('./notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('./queue', () => ({ wakeChannel: vi.fn() }));

describe('reading a visitor’s conversation with a shared Agent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  const service = () => new ChannelService({} as never, 'owner', null);
  const notFound = new ChannelError('NOT_FOUND', 'Channel not found');

  it('opens it read-only for the creator when the caller is not a member', async () => {
    detail.mockRejectedValue(notFound);
    readShareVisitorChannel.mockResolvedValue({
      attachments: [],
      channel: { id: 'chn_visitor', metadata: {}, projectId: null, title: 'Visitor' },
      readOnly: true,
    });

    await expect(service().detail('chn_visitor', undefined)).resolves.toMatchObject({
      channel: { displayTitle: 'Visitor' },
      readOnly: true,
    });
    expect(readShareVisitorChannel).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'chn_visitor',
      undefined,
    );
  });

  it('keeps the original not-found error when the share does not let the caller read it', async () => {
    detail.mockRejectedValue(notFound);
    readShareVisitorChannel.mockResolvedValue(undefined);

    await expect(service().detail('chn_visitor', undefined)).rejects.toBe(notFound);
  });

  it('never falls back for other errors', async () => {
    const forbidden = new ChannelError('FORBIDDEN', 'No access');
    detail.mockRejectedValue(forbidden);

    await expect(service().detail('chn_visitor', undefined)).rejects.toBe(forbidden);
    expect(readShareVisitorChannel).not.toHaveBeenCalled();
  });
});

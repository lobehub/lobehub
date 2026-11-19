// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelError } from '@/database/repositories/channel';

import { ChannelService } from './ChannelService';

const { findTopic, query } = vi.hoisted(() => ({ findTopic: vi.fn(), query: vi.fn() }));
vi.mock('@/database/repositories/channel/shareVisitors', async (original) => ({
  ...(await original<object>()),
  findShareVisitorTopic: findTopic,
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    query = query;
  },
}));
vi.mock('@/database/models/project', () => ({ ProjectModel: class {} }));
vi.mock('@/database/models/device', () => ({ DeviceModel: class {} }));
vi.mock('@/server/services/agent', () => ({ AgentService: class {} }));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFileAccessUrl = vi.fn();
  },
}));
vi.mock('./ChannelCoordinator', () => ({ ChannelCoordinator: class {} }));
vi.mock('./notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('./queue', () => ({ wakeChannel: vi.fn() }));

const visitor = { avatar: 'vee.png', id: 'visitor', name: 'Visitor Vee' };
const service = () => new ChannelService({} as never, 'owner');

describe('reading a share visitor topic', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('refuses a topic the caller may not read, without reading its messages', async () => {
    findTopic.mockResolvedValue(undefined);

    await expect(service().shareVisitorTopic('tpc_1')).rejects.toBeInstanceOf(ChannelError);
    expect(query).not.toHaveBeenCalled();
  });

  it('reads the transcript past the visitor guard and credits the visitor with their turns', async () => {
    findTopic.mockResolvedValue({ agentId: 'agt_1', id: 'tpc_1', visitor });
    query.mockResolvedValue([
      { id: 'msg_1', role: 'user', sender: { fullName: 'Owner', id: 'owner' } },
      { id: 'msg_2', role: 'assistant' },
    ]);

    const { messages } = await service().shareVisitorTopic('tpc_1');

    expect(query).toHaveBeenCalledWith(
      // The whole transcript, not the default newest window: the page holds it without paging.
      { agentId: 'agt_1', pageSize: 100_000, topicId: 'tpc_1' },
      expect.objectContaining({ allowShareVisitor: true }),
    );
    expect(messages).toEqual([
      {
        id: 'msg_1',
        role: 'user',
        sender: { avatar: 'vee.png', fullName: 'Visitor Vee', id: 'visitor' },
      },
      { id: 'msg_2', role: 'assistant' },
    ]);
  });
});

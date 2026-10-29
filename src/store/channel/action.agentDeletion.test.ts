import type { ChannelDetail, ChannelPublicMember } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { channelService } from '@/services/channel';

import { channelActions } from './action';
import { retireChannelAgent } from './agentDeletion';
import { channelViewKey } from './projection';
import { useChannelStore } from './store';

vi.mock('@/services/channel', () => ({ channelService: { detail: vi.fn(), list: vi.fn() } }));

const member: ChannelPublicMember = {
  actorType: 'agent',
  agentId: 'agent',
  avatar: null,
  description: null,
  id: 'member',
  joinedAt: new Date(),
  name: 'Original author',
  role: null,
  status: 'active',
  userAvatar: null,
  userId: null,
  userName: null,
  username: null,
};
const detail: ChannelDetail = {
  attachments: [],
  channel: {
    id: 'channel',
    title: 'Channel',
    canDelete: true,
    sequence: 1,
    status: 'active',
    createdAt: new Date(),
    projectId: null,
    workspaceId: null,
  },
  hasMore: false,
  jobs: [
    {
      blockedCode: 'unavailable',
      canStop: true,
      errorMessage: null,
      id: 'job',
      memberId: member.id,
      messageId: 'request',
      publicationRevoked: false,
      status: 'queued',
      threadId: null,
      writerHeld: false,
    },
  ],
  members: [member],
  messages: [
    {
      id: 'reply',
      agentId: 'agent',
      author: { avatar: null, id: 'agent', name: 'Original author', type: 'agent' },
      content: 'Historical answer',
      createdAt: new Date(),
      fileIds: [],
      mentions: [],
      recipientMemberIds: [],
      replyToId: 'request',
      routingStatus: 'reply',
      sequence: 1,
      threadId: null,
      userId: null,
    },
  ],
  rootMessage: null,
  threads: [],
};
const main = { channelId: 'channel' };
const page = { channelId: 'channel', before: 10 };
const read = () => useChannelStore.getState().detailMap[channelViewKey(main)];

beforeEach(async () => {
  const scope = crypto.randomUUID();
  vi.spyOn(cacheScope, 'get').mockReturnValue(scope);
  vi.spyOn(cacheScope, 'use').mockReturnValue(scope);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  channelActions.reset();
  vi.mocked(channelService.detail).mockResolvedValue(structuredClone(detail));
  await Promise.all([main, page].map(channelActions.refreshDetail));
});
afterEach(() => {
  channelActions.reset();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Deleted Agent Channel cache', () => {
  it('preserves history and removes reply eligibility in every cached page even if refresh fails', async () => {
    vi.mocked(channelService.detail).mockRejectedValue(new Error('offline'));
    await channelActions.retireAgent('agent');
    for (const view of Object.values(useChannelStore.getState().detailMap)) {
      expect(view.members[0]).toMatchObject({ agentDeleted: true, status: 'removed' });
      expect(view.jobs[0]).toMatchObject({ status: 'cancelled', blockedCode: null });
      expect(view.messages[0]).toMatchObject({
        content: 'Historical answer',
        author: { name: 'Original author', deleted: true },
      });
    }
  });

  it('does not resurrect the recipient from a response started before the deletion', async () => {
    const oldResponse = Promise.withResolvers<ChannelDetail>();
    vi.mocked(channelService.detail).mockReturnValueOnce(oldResponse.promise);
    const pending = channelActions.refreshDetail(main);
    vi.mocked(channelService.detail).mockResolvedValue(retireChannelAgent(detail, 'agent'));
    await channelActions.retireAgent('agent');
    oldResponse.resolve(structuredClone(detail));
    await pending;
    expect(read().members[0]).toMatchObject({ agentDeleted: true, status: 'removed' });
    expect(read().jobs[0].status).toBe('cancelled');
  });

  it('retires a first detail response before its roster has entered the cache', async () => {
    channelActions.reset();
    const oldResponse = Promise.withResolvers<ChannelDetail>();
    vi.mocked(channelService.detail).mockReturnValueOnce(oldResponse.promise);
    const pending = channelActions.refreshDetail(main);
    expect(read()).toBeUndefined();
    vi.mocked(channelService.detail).mockResolvedValue(retireChannelAgent(detail, 'agent'));
    await channelActions.retireAgent('agent');
    oldResponse.resolve(structuredClone(detail));
    await pending;
    expect(read().members[0]).toMatchObject({ agentDeleted: true, status: 'removed' });
  });

  it('retires both omitted and explicit-null thread requests for the same page', async () => {
    channelActions.reset();
    const omitted = Promise.withResolvers<ChannelDetail>();
    const explicit = Promise.withResolvers<ChannelDetail>();
    vi.mocked(channelService.detail)
      .mockReturnValueOnce(omitted.promise)
      .mockReturnValueOnce(explicit.promise);
    const pendingOmitted = channelActions.refreshDetail(main);
    const pendingExplicit = channelActions.refreshDetail({ ...main, threadId: null });
    vi.mocked(channelService.detail).mockResolvedValue(retireChannelAgent(detail, 'agent'));
    await channelActions.retireAgent('agent');
    omitted.resolve(structuredClone(detail));
    await pendingOmitted;
    expect(read().members[0]).toMatchObject({ agentDeleted: true, status: 'removed' });
    explicit.resolve(structuredClone(detail));
    await pendingExplicit;
    expect(read().members[0]).toMatchObject({ agentDeleted: true, status: 'removed' });
  });

  it('preserves physical writer ownership while revoking a running reply', () => {
    const running = {
      ...detail,
      jobs: [{ ...detail.jobs[0], status: 'running' as const, writerHeld: true }],
    };
    expect(retireChannelAgent(running, 'agent').jobs[0]).toMatchObject({
      status: 'cancelled',
      publicationRevoked: true,
      writerHeld: true,
    });
    expect(retireChannelAgent(detail, 'other-agent')).toBe(detail);
  });
});

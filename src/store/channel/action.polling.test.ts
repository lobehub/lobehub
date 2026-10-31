import type { ChannelDetail, ChannelPublicJob, ChannelPublicMessage } from '@lobechat/types';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { channelService } from '@/services/channel';

import { CHANNEL_ACTIVE_REFRESH_MS, channelActions } from './action';
import { channelViewKey } from './projection';
import { useChannelStore } from './store';

vi.mock('@/libs/swr', async () => {
  const swr = await import('swr');
  return { mutate: swr.mutate, useClientDataSWR: swr.default };
});
vi.mock('@/services/channel', () => ({
  channelService: { detail: vi.fn(), list: vi.fn(), send: vi.fn() },
}));

const params = { channelId: 'channel', threadId: null };
const message = (routingStatus: ChannelPublicMessage['routingStatus']): ChannelPublicMessage => ({
  agentId: null,
  author: { avatar: null, id: 'user', name: 'User', type: 'user' },
  content: 'Pi, say something',
  createdAt: new Date(),
  fileIds: [],
  id: 'message',
  mentions: [],
  recipientMemberIds: [],
  replyToId: null,
  routingStatus,
  sequence: 1,
  threadId: null,
  userId: 'user',
});
const job = (patch: Partial<ChannelPublicJob> = {}): ChannelPublicJob => ({
  blockedCode: null,
  canStop: true,
  errorMessage: null,
  id: 'job',
  memberId: 'pi',
  messageId: 'message',
  publicationRevoked: false,
  status: 'running',
  threadId: null,
  writerHeld: true,
  ...patch,
});
const detail = (patch: Partial<ChannelDetail> = {}): ChannelDetail => ({
  attachments: [],
  channel: {
    canDelete: true,
    createdAt: new Date(),
    id: 'channel',
    sequence: 1,
    status: 'active',
    title: 'Channel',
    workspaceId: null,
  },
  hasMore: false,
  jobs: [],
  members: [],
  messages: [],
  rootMessage: null,
  threads: [],
  ...patch,
});
const wrapper = ({ children }: PropsWithChildren) =>
  createElement(SWRConfig, {
    children,
    value: {
      dedupingInterval: 0,
      isOnline: () => true,
      isVisible: () => true,
      provider: () => new Map(),
    },
  });
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const current = () => useChannelStore.getState().detailMap[channelViewKey(params)];

describe('Channel in-progress refresh without gateway notifications', () => {
  let response: ChannelDetail;
  beforeEach(() => {
    vi.useFakeTimers();
    const scope = crypto.randomUUID();
    vi.spyOn(cacheScope, 'get').mockReturnValue(scope);
    vi.spyOn(cacheScope, 'use').mockReturnValue(scope);
    vi.spyOn(cacheScope, 'canPersist').mockReturnValue(false);
    vi.spyOn(cacheScope, 'canHydrate').mockReturnValue(false);
    channelActions.reset();
    response = detail();
    vi.mocked(channelService.detail).mockImplementation(async () => response);
    vi.mocked(channelService.list).mockResolvedValue([response.channel]);
    vi.mocked(channelService.send).mockResolvedValue({
      data: { threadId: null },
      success: true,
    } as Awaited<ReturnType<typeof channelService.send>>);
  });
  afterEach(() => {
    cleanup();
    channelActions.reset();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('accelerates an already mounted idle view after sending, then follows receiving → replying → completed', async () => {
    renderHook(() => channelActions.useFetchDetail(params), { wrapper });
    await tick(0);
    expect(current()?.jobs).toEqual([]);

    response = detail({ messages: [message('pending')] });
    await act(async () => {
      await channelActions.send({
        ...params,
        content: 'Pi, say something',
        mentions: [],
        requestKey: 'request',
      });
    });
    expect(current()?.messages[0].routingStatus).toBe('pending');

    response = detail({ messages: [message('assigned')], jobs: [job()] });
    await tick(CHANNEL_ACTIVE_REFRESH_MS);
    expect(current()?.jobs[0]).toMatchObject({ memberId: 'pi', status: 'running' });

    response = detail({
      messages: [message('assigned')],
      jobs: [job({ status: 'completed', writerHeld: false })],
    });
    await tick(CHANNEL_ACTIVE_REFRESH_MS);
    expect(current()?.jobs[0].status).toBe('completed');

    const calls = vi.mocked(channelService.detail).mock.calls.length;
    await tick(5000);
    expect(channelService.detail).toHaveBeenCalledTimes(calls);
  });

  it.each([
    ['queued', job({ status: 'queued', writerHeld: false })],
    [
      'queued behind earlier work',
      job({ blockedCode: 'member_busy', status: 'queued', writerHeld: false }),
    ],
    ['running', job()],
    ['stopping', job({ status: 'cancelled', publicationRevoked: true })],
  ])('keeps refreshing a %s job until its next state is visible', async (_label, pendingJob) => {
    response = detail({ jobs: [pendingJob], messages: [message('assigned')] });
    renderHook(() => channelActions.useFetchDetail(params), { wrapper });
    await tick(0);
    response = detail({ jobs: [job({ status: 'completed', writerHeld: false })] });
    await tick(CHANNEL_ACTIVE_REFRESH_MS);
    expect(current()?.jobs[0].status).toBe('completed');
  });

  it.each(['skipped', 'unassigned'] as const)(
    'slows down once receipt resolves to %s without a job',
    async (status) => {
      response = detail({ messages: [message('pending')] });
      renderHook(() => channelActions.useFetchDetail(params), { wrapper });
      await tick(0);
      response = detail({ messages: [message(status)] });
      await tick(CHANNEL_ACTIVE_REFRESH_MS);
      expect(current()?.messages[0].routingStatus).toBe(status);
      const calls = vi.mocked(channelService.detail).mock.calls.length;
      await tick(5000);
      expect(channelService.detail).toHaveBeenCalledTimes(calls);
    },
  );

  it('does not fast-poll the main view for another thread or a fully stopped job', async () => {
    response = detail({
      jobs: [
        job({ threadId: 'other' }),
        job({ id: 'stopped', status: 'cancelled', publicationRevoked: true, writerHeld: false }),
      ],
    });
    renderHook(() => channelActions.useFetchDetail(params), { wrapper });
    await tick(0);
    const calls = vi.mocked(channelService.detail).mock.calls.length;
    await tick(5000);
    expect(channelService.detail).toHaveBeenCalledTimes(calls);
  });

  it('does not fast-poll a queued job blocked on a device or a person', async () => {
    response = detail({
      jobs: [job({ blockedCode: 'device_offline', status: 'queued', writerHeld: false })],
    });
    renderHook(() => channelActions.useFetchDetail(params), { wrapper });
    await tick(0);
    const calls = vi.mocked(channelService.detail).mock.calls.length;
    await tick(5000);
    expect(channelService.detail).toHaveBeenCalledTimes(calls);
  });

  it('stops polling on unmount', async () => {
    response = detail({ messages: [message('pending')] });
    const { unmount } = renderHook(() => channelActions.useFetchDetail(params), { wrapper });
    await tick(0);
    unmount();
    const calls = vi.mocked(channelService.detail).mock.calls.length;
    await tick(5000);
    expect(channelService.detail).toHaveBeenCalledTimes(calls);
  });

  it('does not fetch a disabled view', async () => {
    renderHook(() => channelActions.useFetchDetail(null), { wrapper });
    await tick(5000);
    expect(channelService.detail).not.toHaveBeenCalled();
  });
});

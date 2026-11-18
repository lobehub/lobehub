// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelError } from '@/database/repositories/channel';

import { ChannelThreadService, runChannelWatchReport, steerEntryId } from './ChannelThreadService';

const mocks = vi.hoisted(() => ({
  currentRun: vi.fn(),
  isLocalExecution: vi.fn(),
  isStopped: vi.fn(),
  queueRunSteer: vi.fn(),
  scheduleMessage: vi.fn(),
  send: vi.fn(),
  stop: vi.fn(),
  threadTarget: vi.fn(),
}));

vi.mock('@/database/repositories/channel', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChannelHistoryRepository: vi.fn(function () {
    return { currentRun: mocks.currentRun, threadTarget: mocks.threadTarget };
  }),
}));
vi.mock('./ChannelService', () => ({
  ChannelService: vi.fn(function () {
    return { send: mocks.send, stop: mocks.stop };
  }),
}));
vi.mock('./featureGate', () => ({ assertChannelEnabled: vi.fn() }));
vi.mock('@/server/services/aiAgent/steerQueue/subAgent', () => ({
  queueRunSteer: mocks.queueRunSteer,
}));
vi.mock('@/server/services/queue', () => ({
  QueueService: vi.fn(function () {
    return { isLocalExecution: mocks.isLocalExecution, scheduleMessage: mocks.scheduleMessage };
  }),
}));
vi.mock('@/server/services/redis', () => ({
  redisService: { channelWatch: { isStopped: mocks.isStopped, stop: vi.fn() } },
}));

const self = { agentId: 'agt-1', memberId: 'mem-agent', name: 'Worker' };
const run = { channelId: 'chn_1', manifest: { self, threadId: null } };
const runningJob = {
  executionConfig: { runtime: 'native' },
  id: 'job-1',
  operationId: 'op-thread',
  operationStatus: 'running',
  operationUserId: 'user-1',
  status: 'running',
  topicId: 'tpc-thread',
};
const target = (openJobs: unknown[] = [runningJob]) => ({
  channelId: 'chn_1',
  openJobs,
  relayed: false,
  self,
  threadId: 'cht_1',
});

/** The member lookup `createThread` makes; nothing else reads the database directly here. */
const db = {
  select: () => ({
    from: () => ({ where: () => ({ limit: async () => [{ id: 'mem-agent', name: 'Worker' }] }) }),
  }),
} as any;
const service = () => new ChannelThreadService(db, 'user-1', 'op-main', 'ws-1');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentRun.mockResolvedValue(run);
  mocks.threadTarget.mockResolvedValue(target());
  mocks.send.mockImplementation(async (_channelId, input) => ({
    id: `msg-${input.requestKey}`,
    threadId: input.threadId ?? (input.rootMessageId ? 'cht_new' : null),
  }));
  mocks.isLocalExecution.mockReturnValue(false);
  mocks.isStopped.mockResolvedValue(false);
});

describe('ChannelThreadService.steerThread', () => {
  it('joins the correction into the running reply and posts it for the record', async () => {
    mocks.queueRunSteer.mockResolvedValue({ queued: true });

    await expect(
      service().steerThread({ content: 'Use the v2 API', threadId: 'cht_1' }, 'call-1'),
    ).resolves.toEqual({
      delivery: 'steered',
      messageId: 'msg-agent-steer:op-main:call-1',
      threadId: 'cht_1',
    });
    expect(mocks.queueRunSteer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entry: expect.objectContaining({
          channelSteer: true,
          request: expect.objectContaining({
            agentId: 'agt-1',
            prompt: expect.stringContaining('Use the v2 API'),
          }),
          userId: 'user-1',
        }),
        operationId: 'op-thread',
        scope: { threadId: null, topicId: 'tpc-thread', userId: 'user-1' },
      }),
    );
    expect(mocks.send).toHaveBeenCalledWith(
      'chn_1',
      expect.objectContaining({ silent: true, threadId: 'cht_1' }),
    );
  });

  it.each([
    ['the run ended before it read the queue', [runningJob], { queued: false, reason: 'ended' }],
    ['nothing runs there', [], undefined],
    [
      'the reply runs on a device runtime',
      [{ ...runningJob, executionConfig: { runtime: 'claude-code' } }],
      undefined,
    ],
    [
      'another person asked for the reply',
      [{ ...runningJob, operationUserId: 'user-2' }],
      undefined,
    ],
  ])('posts it as a new request when %s', async (_case, openJobs, outcome) => {
    mocks.threadTarget.mockResolvedValue(target(openJobs));
    if (outcome) mocks.queueRunSteer.mockResolvedValue(outcome);

    const result = await service().steerThread(
      { content: 'Use the v2 API', threadId: 'cht_1' },
      'call-1',
    );

    expect(result.delivery).toBe('queued');
    expect(mocks.send).toHaveBeenCalledWith('chn_1', {
      content: '@Worker Use the v2 API',
      mentions: ['mem-agent'],
      metadata: { via: { agentId: 'agt-1', name: 'Worker', operationId: 'op-main' } },
      requestKey: 'agent-steer:op-main:call-1',
      threadId: 'cht_1',
    });
    if (!outcome) expect(mocks.queueRunSteer).not.toHaveBeenCalled();
  });

  it('appends the same steer entry when the tool call is retried', async () => {
    mocks.queueRunSteer.mockResolvedValue({ queued: true });

    await service().steerThread({ content: 'x', threadId: 'cht_1' }, 'call-1');
    await service().steerThread({ content: 'x', threadId: 'cht_1' }, 'call-1');

    const [first, retry] = mocks.queueRunSteer.mock.calls.map(([, params]) => params.entry.id);
    expect(first).toBe(retry);
    expect(first).toBe(steerEntryId('op-main', 'call-1'));
    expect(first).toMatch(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/);
    expect(steerEntryId('op-main', 'call-2')).not.toBe(first);
  });

  it('refuses to resend a correction that may already have landed', async () => {
    mocks.queueRunSteer.mockResolvedValue({ queued: false, reason: 'unknown' });

    await expect(
      service().steerThread({ content: 'x', threadId: 'cht_1' }, 'call-1'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe('ChannelThreadService.createThread', () => {
  it('posts the title as a silent root, then the request in its Thread', async () => {
    await expect(
      service().createThread({ content: 'Write chapter 2', title: 'Chapter 2' }, 'call-9'),
    ).resolves.toEqual({
      agent: { agentId: 'agt-1', name: 'Worker' },
      messageId: 'msg-agent-thread:op-main:call-9',
      threadId: 'cht_new',
      title: 'Chapter 2',
    });
    expect(mocks.send.mock.calls.map(([, input]) => input)).toEqual([
      expect.objectContaining({ content: 'Chapter 2', silent: true }),
      expect.objectContaining({
        content: '@Worker Write chapter 2',
        rootMessageId: 'msg-agent-thread-root:op-main:call-9',
      }),
    ]);
  });

  it('does not fan out from a request an Agent posted', async () => {
    mocks.currentRun.mockResolvedValue({ ...run, requestVia: { agentId: 'agt-1', name: 'W' } });

    await expect(
      service().createThread({ content: 'x', title: 'y' }, 'call-1'),
    ).rejects.toBeInstanceOf(ChannelError);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe('ChannelThreadService.stopThread', () => {
  it('stops the Thread branch it targets', async () => {
    await expect(service().stopThread({ threadId: 'cht_1' })).resolves.toEqual({
      stopped: 1,
      threadId: 'cht_1',
    });
    expect(mocks.stop).toHaveBeenCalledWith('chn_1', { threadId: 'cht_1' });
  });
});

describe('Thread watches', () => {
  it('needs the queue runtime', async () => {
    mocks.isLocalExecution.mockReturnValue(true);

    await expect(
      service().watchThreads({ intervalMinutes: 5, threadIds: ['cht_1'] }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('schedules the first report one interval out', async () => {
    const watched = await service().watchThreads({ intervalMinutes: 5, threadIds: ['cht_1'] });

    expect(watched).toMatchObject({ intervalMinutes: 5, maxReports: 12, threadIds: ['cht_1'] });
    expect(mocks.scheduleMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        delay: 300_000,
        payload: expect.objectContaining({ report: 1, watchId: watched.watchId }),
      }),
    );
  });

  it('drops a report of a stopped watch', async () => {
    mocks.isStopped.mockResolvedValue(true);

    await expect(
      runChannelWatchReport({} as any, {
        agent: { agentId: 'agt-1', memberId: 'mem-agent', name: 'Worker' },
        channelId: 'chn_1',
        intervalMinutes: 5,
        maxReports: 3,
        operationId: 'op-main',
        report: 2,
        threadIds: ['cht_1'],
        userId: 'user-1',
        watchId: 'w-1',
      }),
    ).resolves.toBe('stopped');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelCoordinator } from './ChannelCoordinator';

const { executions, findLatest } = vi.hoisted(() => ({
  executions: {
    accepted: vi.fn(),
    publish: vi.fn(),
    // An untouched reservation short-circuits the physical stop: not what these tests are about.
    retireReservation: vi.fn().mockResolvedValue(true),
    saveDraft: vi.fn(),
    silence: vi.fn().mockResolvedValue(true),
  },
  findLatest: vi.fn(),
}));
vi.mock('@/database/repositories/channel', () => ({
  ChannelExecutionRepository: class {
    constructor() {
      return executions;
    }
  },
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    findLatestAssistantByOperationId = findLatest;
  },
}));
vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: class {} }));
vi.mock('@/server/services/deviceGateway', () => ({ deviceGateway: {} }));
vi.mock('@/server/globalConfig', () => ({ getServerDefaultAgentConfig: vi.fn() }));
vi.mock('@/server/services/deviceGateway/scopedDevices', () => ({
  getScopedOnlineDevices: vi.fn(),
}));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: vi.fn() }));
vi.mock('./ChannelRoutingService', () => ({ ChannelRoutingService: vi.fn() }));
vi.mock('./attachments', () => ({ resolveChannelAttachments: vi.fn() }));
vi.mock('./notify', () => ({ notifyChannel: vi.fn() }));
vi.mock('./queue', () => ({ registerLocalChannelAdvance: vi.fn(), wakeChannel: vi.fn() }));

const coordinator = (job: Record<string, unknown>) => {
  const row = {
    job: {
      channelId: 'channel',
      draft: null,
      id: 'job',
      manifest: {},
      operationId: 'op',
      publicationRevoked: false,
      status: 'running',
      topicId: 'topic',
      writerHeld: true,
      ...job,
    },
    operation: { id: 'op', status: 'done', topicId: 'topic', userId: 'user', workspaceId: null },
  };
  const rows = [{ ...row, config: { runtime: 'codex' } }];
  const query = Object.assign(Promise.resolve(rows), {
    from: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    limit: vi.fn(),
    where: vi.fn(),
  });
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'limit'] as const)
    query[method].mockReturnValue(query);
  return new ChannelCoordinator({ select: () => query } as never);
};

describe('Channel completion of a wake that may stay silent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('settles a follow-up that answered NO_REPLY without publishing', async () => {
    findLatest.mockResolvedValue({ content: 'NO_REPLY:not_addressed' });
    await coordinator({ wake: { kind: 'followup' } }).complete('channel', 'job', 'op');

    expect(executions.silence).toHaveBeenCalledWith('channel', 'job', 'not_addressed');
    expect(executions.saveDraft).not.toHaveBeenCalled();
    expect(executions.publish).not.toHaveBeenCalled();
  });

  it('does not count a follow-up that ran out of steps on a tool call as silence', async () => {
    findLatest.mockResolvedValue({ content: '', tools: [{ id: 'call' }] });
    await coordinator({ wake: { kind: 'followup' } }).complete('channel', 'job', 'op');

    expect(executions.silence).not.toHaveBeenCalled();
    expect(executions.publish).not.toHaveBeenCalled();
  });

  it('publishes the token as text when the member owed an answer', async () => {
    findLatest.mockResolvedValue({ content: 'NO_REPLY' });
    await coordinator({ wake: null }).complete('channel', 'job', 'op');

    expect(executions.silence).not.toHaveBeenCalled();
    expect(executions.saveDraft).toHaveBeenCalledWith('channel', 'job', 'NO_REPLY');
    expect(executions.publish).toHaveBeenCalled();
  });

  it('does not publish an empty draft for a job already settled in silence', async () => {
    await coordinator({ draft: '', status: 'silent', wake: { kind: 'followup' } }).complete(
      'channel',
      'job',
      'op',
    );

    expect(findLatest).not.toHaveBeenCalled();
    expect(executions.publish).not.toHaveBeenCalled();
  });
});

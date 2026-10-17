// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicStartReservationError } from '@/server/services/aiAgent/topicStartReservation';

import { createAgentInboundWaker } from '../waker';

const { execAgent, findThreadTopicId, findTopic, markWoken } = vi.hoisted(() => ({
  execAgent: vi.fn(),
  findThreadTopicId: vi.fn(),
  findTopic: vi.fn(),
  markWoken: vi.fn(async () => {}),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: class {
    execAgent = execAgent;
  },
}));
vi.mock('@/database/models/agentInbox', () => ({
  AgentInboxModel: { findThreadTopicId, markWoken },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = findTopic;
  },
}));

const account = {
  agentId: 'agt_1',
  id: 'acc_1',
  identifier: 'agent@lobe.id',
  kind: 'mail',
  userId: 'user_1',
  workspaceId: null,
} as any;
const message = {
  codes: [],
  from: 'human@example.com',
  id: 'msg_1',
  metadata: {},
  receivedAt: new Date('2026-10-02T00:00:00Z'),
  subject: 'Re: hello',
  text: 'ping',
  threadKey: '<root@example.com>',
  to: 'agent@lobe.id',
} as any;

const waker = createAgentInboundWaker({} as any);

beforeEach(() => {
  vi.clearAllMocks();
  findThreadTopicId.mockResolvedValue('tpc_deleted');
});

describe('inbound waker — thread topics', () => {
  it('wakes in a fresh topic when the thread topic was deleted, instead of failing every retry', async () => {
    execAgent
      .mockRejectedValueOnce(new TopicStartReservationError('Topic not found: tpc_deleted'))
      .mockResolvedValueOnce({ topicId: 'tpc_fresh' });
    findTopic.mockResolvedValue(undefined);

    const result = await waker.wake({ account, message });

    expect(result).toEqual({ reason: 'started', started: true, topicId: 'tpc_fresh' });
    expect(execAgent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ appContext: { scope: 'agent', topicId: undefined } }),
    );
    expect(markWoken).toHaveBeenCalledWith(expect.anything(), 'msg_1', 'tpc_fresh');
  });

  it('leaves a busy thread topic to the provider retry rather than forking the thread', async () => {
    execAgent.mockRejectedValueOnce(
      new TopicStartReservationError('Topic tpc_deleted remained busy while starting operation x'),
    );
    findTopic.mockResolvedValue({ id: 'tpc_deleted' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await waker.wake({ account, message });

    expect(result).toEqual({ reason: 'start-failed', started: false });
    expect(execAgent).toHaveBeenCalledTimes(1);
    expect(markWoken).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

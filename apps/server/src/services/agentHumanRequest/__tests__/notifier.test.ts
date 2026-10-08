// @vitest-environment node
import type { AgentHumanRequestItem } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TopicStartReservationError } from '@/server/services/aiAgent/topicStartReservation';

import { createAgentHumanRequestNotifier } from '../notifier';

const execAgent = vi.fn();
const findTopic = vi.fn();

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn(function AiAgentService() {
    return { execAgent };
  }),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn(function TopicModel() {
    return { findById: findTopic };
  }),
}));

const item = {
  action: { channel: 'mail', to: 'bob@example.com' },
  agentId: 'agt_1',
  id: 'hreq_1',
  result: { providerMessageId: 'pm-1' },
  status: 'completed',
  topicId: 'tpc_parked',
  type: 'approval',
} as unknown as AgentHumanRequestItem;

const notifier = () => createAgentHumanRequestNotifier({} as never, 'user_1');

const topicIdsOfCalls = () =>
  execAgent.mock.calls.map(([params]) => params.appContext.topicId as string | undefined);

beforeEach(() => {
  execAgent.mockReset();
  findTopic.mockReset();
});

describe('createAgentHumanRequestNotifier', () => {
  it('reports the outcome in the topic that parked the action', async () => {
    execAgent.mockResolvedValue({ topicId: 'tpc_parked' });

    await notifier().notify(item);

    expect(topicIdsOfCalls()).toEqual(['tpc_parked']);
  });

  it('falls back to a fresh topic when the parking topic was deleted (reservation throw)', async () => {
    execAgent
      .mockRejectedValueOnce(new TopicStartReservationError('Topic not found: tpc_parked'))
      .mockResolvedValueOnce({ topicId: 'tpc_new' });
    findTopic.mockResolvedValue(undefined);

    await notifier().notify(item);

    expect(topicIdsOfCalls()).toEqual(['tpc_parked', undefined]);
  });

  it('keeps a busy topic: rethrows so redelivery retries in the same conversation', async () => {
    execAgent.mockRejectedValueOnce(
      new TopicStartReservationError('Topic tpc_parked remained busy while starting operation x'),
    );
    findTopic.mockResolvedValue({ id: 'tpc_parked' });

    await expect(notifier().notify(item)).rejects.toThrow(/remained busy/);
    expect(topicIdsOfCalls()).toEqual(['tpc_parked']);
  });

  it('falls back when a deleted topic is reported as a result error', async () => {
    execAgent
      .mockResolvedValueOnce({ error: 'Topic not found' })
      .mockResolvedValueOnce({ topicId: 'tpc_new' });
    findTopic.mockResolvedValue(undefined);

    await notifier().notify(item);

    expect(topicIdsOfCalls()).toEqual(['tpc_parked', undefined]);
  });

  it('does not swallow unrelated failures', async () => {
    execAgent.mockRejectedValueOnce(new Error('model provider down'));

    await expect(notifier().notify(item)).rejects.toThrow(/provider down/);
    expect(findTopic).not.toHaveBeenCalled();
  });
});

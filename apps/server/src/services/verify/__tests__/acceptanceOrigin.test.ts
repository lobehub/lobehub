// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptanceService } from '../acceptanceService';

const getAgentAvatarsByIds = vi.fn();
const findTopicById = vi.fn();

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(function () {
    return { getAgentAvatarsByIds };
  }),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(function () {
    return { findById: findTopicById };
  }),
}));

const agentRow = (id: string) => ({ avatar: '🦊', backgroundColor: null, id, title: 'Fox' });
const runWithOrigin = (origin: Record<string, string>) => ({ metadata: { origin } }) as never;

/**
 * Rounds published from a dispatched run (task / goal / device) carry only the
 * topic — the connector strips the ambient agent id. The topic row still names
 * its agent, so the origin must resolve to it instead of hiding the
 * conversation panel and the agent chip.
 */
describe('AcceptanceService.resolveOrigin', () => {
  const service = new AcceptanceService({} as never, 'user', 'ws');

  beforeEach(() => {
    getAgentAvatarsByIds.mockReset();
    findTopicById.mockReset();
  });

  it("falls back to the topic's agent when the round recorded none", async () => {
    findTopicById.mockResolvedValue({ agentId: 'agt_topic', id: 'tpc_1', title: 'Harbor' });
    getAgentAvatarsByIds.mockResolvedValue([agentRow('agt_topic')]);

    const origin = await service.resolveOrigin([runWithOrigin({ topicId: 'tpc_1' })]);

    expect(getAgentAvatarsByIds).toHaveBeenCalledWith(['agt_topic']);
    expect(origin).toEqual({
      agent: agentRow('agt_topic'),
      topic: { id: 'tpc_1', title: 'Harbor' },
    });
  });

  it('keeps the recorded agent over the topic owner', async () => {
    findTopicById.mockResolvedValue({ agentId: 'agt_topic', id: 'tpc_1', title: 'Harbor' });
    getAgentAvatarsByIds.mockResolvedValue([agentRow('agt_recorded')]);

    const origin = await service.resolveOrigin([
      runWithOrigin({ agentId: 'agt_recorded', topicId: 'tpc_1' }),
    ]);

    expect(getAgentAvatarsByIds).toHaveBeenCalledWith(['agt_recorded']);
    expect(origin?.agent?.id).toBe('agt_recorded');
  });

  it('leaves the agent empty when neither the round nor the topic names one', async () => {
    findTopicById.mockResolvedValue({ agentId: null, id: 'tpc_1', title: 'Harbor' });

    const origin = await service.resolveOrigin([runWithOrigin({ topicId: 'tpc_1' })]);

    expect(getAgentAvatarsByIds).not.toHaveBeenCalled();
    expect(origin).toEqual({ agent: null, topic: { id: 'tpc_1', title: 'Harbor' } });
  });
});

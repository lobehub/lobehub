import { describe, expect, it } from 'vitest';

import type { ChatStoreState } from '@/store/chat/initialState';

import { selectActiveTopics } from './selectActiveTopics';

const topic = (id: string, status?: string) => ({ id, status, title: `Title ${id}` });

const state = (overrides: Partial<Record<string, unknown>>) =>
  ({
    operations: {},
    operationsByType: {},
    topicDataMap: {},
    topicDetailMap: {},
    ...overrides,
  }) as unknown as ChatStoreState;

describe('selectActiveTopics', () => {
  it('collects running and awaiting-input topics with owners parsed from bucket keys', () => {
    const result = selectActiveTopics(
      state({
        topicDataMap: {
          agent_agt_1: { items: [topic('t1', 'running'), topic('t2', 'active')] },
          group_grp_1: { items: [topic('t3', 'waitingForHuman')] },
        },
      }),
    );

    expect(result).toEqual([
      { agentId: 'agt_1', status: 'running', title: 'Title t1', topicId: 't1' },
      { groupId: 'grp_1', status: 'waitingForHuman', title: 'Title t3', topicId: 't3' },
    ]);
  });

  it('marks topics with a local running operation and resolves ambiguous buckets from it', () => {
    const result = selectActiveTopics(
      state({
        operations: {
          op1: {
            context: { agentId: 'agt_1', groupId: 'grp_1', topicId: 't1' },
            metadata: {},
            status: 'running',
          },
        },
        operationsByType: { execAgentRuntime: ['op1'] },
        topicDataMap: {
          group_agent_grp_1_agt_1: { items: [topic('t1', 'active')] },
          group_agent_grp_2_agt_2: { items: [topic('t2', 'running')] },
        },
      }),
    );

    expect(result).toEqual([
      { agentId: 'agt_1', groupId: 'grp_1', status: 'running', title: 'Title t1', topicId: 't1' },
    ]);
  });
});

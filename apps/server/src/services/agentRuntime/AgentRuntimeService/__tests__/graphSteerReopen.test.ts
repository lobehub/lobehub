import type { AgentState } from '@lobechat/agent-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withGraphSteerReopen } from '../graphSteerReopen';

const { steerQueueUnseal } = vi.hoisted(() => ({ steerQueueUnseal: vi.fn() }));

vi.mock('@/server/services/redis', () => ({
  redisService: { steerQueue: { unseal: steerQueueUnseal } },
}));

const subAgentOrigin = {
  agentId: 'agt-1',
  lineage: { isSubAgent: true, parentOperationId: 'op-parent' },
  threadId: 'thd-sub',
  topicId: 'tpc-1',
};

const stateOf = (phase?: 'node_in' | 'node_out' | 'fin', origin: unknown = subAgentOrigin) =>
  ({
    metadata: phase
      ? {
          __graphRuntimeState: {
            graphContext: { edgeTraversalCounts: {}, store: {} },
            graphState:
              phase === 'fin'
                ? { phase, reason: 'completed' }
                : { active: true, attempts: 1, currentNode: 'work', phase },
            instructionCount: 3,
            terminalNode: 'verify',
          },
        }
      : undefined,
    origin,
  }) as unknown as AgentState;

const instruction = { payload: {}, type: 'call_llm' } as any;
const context = { phase: 'llm_result' } as any;

describe('withGraphSteerReopen', () => {
  const callLlm = vi.fn();
  const callTool = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    callLlm.mockResolvedValue({ events: [], newState: {} });
    steerQueueUnseal.mockResolvedValue(undefined);
  });

  it('reopens the queue before a graph sub-agent starts another node’s work', async () => {
    const order: string[] = [];
    steerQueueUnseal.mockImplementation(async () => order.push('unseal'));
    callLlm.mockImplementation(async () => {
      order.push('call_llm');
      return { events: [], newState: {} };
    });
    const executors = withGraphSteerReopen({ call_llm: callLlm }, 'op-child');

    await executors.call_llm!(instruction, stateOf('node_in'), context);

    expect(steerQueueUnseal).toHaveBeenCalledWith('op-child');
    expect(order).toEqual(['unseal', 'call_llm']);
  });

  it.each([
    ['a node’s output extraction', stateOf('node_out')],
    ['a run no graph drives', stateOf()],
    ['a top-level graph run', stateOf('node_in', { agentId: 'agt-1', topicId: 'tpc-1' })],
  ])('leaves the seal alone for %s', async (_case, state) => {
    const executors = withGraphSteerReopen({ call_llm: callLlm }, 'op-child');

    await executors.call_llm!(instruction, state, context);

    expect(steerQueueUnseal).not.toHaveBeenCalled();
    expect(callLlm).toHaveBeenCalledWith(instruction, state, context);
  });

  it('still makes the LLM call when reopening fails', async () => {
    steerQueueUnseal.mockRejectedValue(new Error('redis down'));
    const executors = withGraphSteerReopen({ call_llm: callLlm }, 'op-child');

    await expect(executors.call_llm!(instruction, stateOf('node_in'), context)).resolves.toEqual({
      events: [],
      newState: {},
    });
    expect(callLlm).toHaveBeenCalledTimes(1);
  });

  it('leaves the other executors as they are', () => {
    const executors = withGraphSteerReopen({ call_llm: callLlm, call_tool: callTool }, 'op');

    expect(executors.call_tool).toBe(callTool);
    expect(withGraphSteerReopen({ call_tool: callTool }, 'op')).toEqual({ call_tool: callTool });
  });
});

import { AGENT_GRAPH_ROOT_NODE_ID } from '@lobechat/types/agent/graph';
import { describe, expect, it } from 'vitest';

import type { AgentRuntimeContext, AgentState } from '../../../types';
import { GraphAgent, isGraphAgentIntermediateResult } from '../GraphAgent';

const llmResult: AgentRuntimeContext = {
  payload: {
    hasToolsCalling: false,
    result: { content: 'done', tool_calls: [] },
    toolsCalling: [],
  },
  phase: 'llm_result',
};

const createState = (): AgentState =>
  ({
    messages: [{ content: 'Draft, then review.', role: 'user' }],
    operationId: 'test-operation',
    status: 'running',
    stepCount: 0,
    toolManifestMap: {},
    tools: [],
  }) as unknown as AgentState;

describe('isGraphAgentIntermediateResult', () => {
  it('tells a graph node before the terminal one from the terminal node', async () => {
    const agent = new GraphAgent({
      agentConfig: { maxSteps: 100 },
      graph: {
        edges: [
          { from: AGENT_GRAPH_ROOT_NODE_ID, instruction: 'Write a draft.', to: 'draft' },
          { from: 'draft', instruction: 'Review the draft.', to: 'review' },
        ],
        fields: {},
        name: 'draft-review',
        nodes: { draft: { type: 'llm' }, review: { type: 'llm' } },
        terminal: 'review',
      },
      operationId: 'test-operation',
    });
    const state = createState();

    await agent.runner({ phase: 'init' } as AgentRuntimeContext, state);
    // The draft node's tool-free result moves the graph on to the review node.
    expect(isGraphAgentIntermediateResult(state)).toBe(true);

    await agent.runner(llmResult, state);
    // The review node's result can finish the graph.
    expect(isGraphAgentIntermediateResult(state)).toBe(false);

    await expect(agent.runner(llmResult, state)).resolves.toMatchObject({ type: 'finish' });
  });

  it('is false for a run no graph drives', () => {
    expect(isGraphAgentIntermediateResult(createState())).toBe(false);
  });
});

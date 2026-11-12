import { AGENT_GRAPH_ROOT_NODE_ID } from '@lobechat/types/agent/graph';
import { describe, expect, it } from 'vitest';

import type { AgentRuntimeContext, AgentState } from '../../../types';
import {
  GraphAgent,
  isGraphAgentIntermediateResult,
  isGraphAgentOutputExtraction,
} from '../GraphAgent';

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

  it('answers a steer joined at an intermediate node again on that node', async () => {
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

    // The draft node answered and a steer joined before the graph moved on.
    state.messages.push(
      { content: 'first draft', role: 'assistant' } as any,
      { content: 'Make it shorter.', role: 'user' } as any,
    );
    const steered = await agent.runner(
      { payload: { parentMessageId: 'msg-steer' }, phase: 'user_input' } as AgentRuntimeContext,
      state,
    );

    // The draft node runs again with its own stage context, not the review node.
    expect(steered).toMatchObject({
      payload: { additionalContexts: expect.anything() },
      type: 'call_llm',
    });
    expect(JSON.stringify(steered)).toContain('Write a draft.');
    expect(JSON.stringify(steered)).not.toContain('Review the draft.');
    expect(isGraphAgentIntermediateResult(state)).toBe(true);

    // Its new answer moves the graph on as usual.
    await agent.runner(llmResult, state);
    expect(isGraphAgentIntermediateResult(state)).toBe(false);
  });

  it('is false for a run no graph drives', () => {
    expect(isGraphAgentIntermediateResult(createState())).toBe(false);
  });
});

describe('isGraphAgentOutputExtraction', () => {
  it('tells a node’s output extraction from the node’s own work', async () => {
    const agent = new GraphAgent({
      agentConfig: { maxSteps: 100 },
      graph: {
        edges: [
          {
            from: AGENT_GRAPH_ROOT_NODE_ID,
            instruction: 'Write a draft.',
            output: { fields: [{ field: 'draft' }] },
            to: 'draft',
          },
          { from: 'draft', instruction: 'Review the draft.', to: 'review' },
        ],
        fields: { draft: { desc: 'The draft.', schema: { type: 'string' } } },
        name: 'draft-review',
        nodes: { draft: { type: 'llm' }, review: { type: 'llm' } },
        terminal: 'review',
      },
      operationId: 'test-operation',
    });
    const state = createState();

    await agent.runner({ phase: 'init' } as AgentRuntimeContext, state);
    // The draft node is doing its own work.
    expect(isGraphAgentOutputExtraction(state)).toBe(false);

    // A reply without the output JSON makes the graph ask for it.
    await expect(agent.runner(llmResult, state)).resolves.toMatchObject({
      stepLabel: 'draft:extract',
      type: 'call_llm',
    });
    expect(isGraphAgentOutputExtraction(state)).toBe(true);

    await agent.runner(
      {
        ...llmResult,
        payload: {
          ...(llmResult.payload as object),
          result: { content: '```json\n{"draft":"d"}\n```' },
        },
      } as AgentRuntimeContext,
      state,
    );
    // The extracted output moved the graph on to the review node's own work.
    expect(isGraphAgentOutputExtraction(state)).toBe(false);
  });

  it('is false for a run no graph drives', () => {
    expect(isGraphAgentOutputExtraction(createState())).toBe(false);
  });
});

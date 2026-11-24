import type { ChatToolPayload } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { GeneralChatAgent } from '../../agents/GeneralChatAgent';
import { createAgentRuntimeExecutors } from '../../executors/registry';
import { createState, createToolExecutorFixture } from '../../executors/tool.testUtils';
import type { LLMAttemptInput, LLMAttemptOutput } from '../../transport';
import type { AgentEvent, AgentRuntimeContext, AgentState } from '../../types';
import { TOOL_CALL_BUDGET_PER_OPERATION, toolCallBudgetStopNote } from '../../utils/toolCallBudget';
import { TOOL_CALL_BURST_LIMIT, TOOL_CALL_REPEAT_LIMIT } from '../../utils/toolCallRepeatGuard';
import { AgentRuntime } from '../runtime';

/**
 * GH #23657: one reply called `searchUserMemory` 500 times with 500 different
 * arguments and ended as `ExceededContextWindow`. These replay that loop through
 * the real runtime, agent and `call_llm` / tool executors; only the model and
 * the tool backend are stubbed.
 */

const SEARCH_TOOL = 'lobe-user-memory/searchUserMemory';

const toolCall = (identifier: string, apiName: string, id: string, args: unknown) =>
  ({
    apiName,
    arguments: JSON.stringify(args),
    id,
    identifier,
    type: 'builtin',
  }) satisfies ChatToolPayload;

const searchCall = (turn: number, index = 0) =>
  toolCall('lobe-user-memory', 'searchUserMemory', `search-${turn}-${index}`, {
    queries: [`rephrased query ${turn}.${index}`],
  });

const output = (content: string, toolsCalling: ChatToolPayload[]): LLMAttemptOutput => ({
  answerSalvagedFromReasoning: false,
  content,
  contentParts: [],
  grounding: null,
  hasContentImages: false,
  hasReasoningImages: false,
  imageList: [],
  reasoningParts: [],
  thinkingContent: '',
  toolCalls: toolsCalling.map((tool) => ({
    function: { arguments: tool.arguments, name: `${tool.identifier}____${tool.apiName}` },
    id: tool.id,
    type: 'function' as const,
  })),
  toolsCalling,
});

/** What the model does on one turn, given whether the request still carried tools. */
type ModelTurn = (turn: number, toolsOffered: boolean) => LLMAttemptOutput;

const replay = async (model: ModelTurn, seed?: Partial<AgentState>, maxTurns = 200) => {
  const fixture = createToolExecutorFixture();
  const toolsOfferedByTurn: boolean[] = [];
  const updates = fixture.host.transports.messages.update as ReturnType<typeof vi.fn>;
  let assistantRows = 0;

  fixture.host.transports.messages.createAssistantMessage = vi.fn(async () => ({
    id: `assistant-${++assistantRows}`,
  })) as any;
  fixture.host.transports.messages.findById = vi.fn(async (id: string) => ({
    id,
    role: 'user',
  })) as any;
  fixture.host.transports.context = {
    // Mirrors both hosts' context builders: forceFinish strips every tool.
    build: vi.fn(async ({ state }: { state: AgentState }) => ({
      messages: [{ content: 'What do you remember about me?', role: 'user' }],
      replayAssistantReasoning: false,
      resolvedTools: { tools: state.forceFinish ? [] : [{ type: 'function' }] },
    })),
  } as any;
  fixture.host.transports.llm = {
    retryPolicy: {
      classifyError: () => ({ code: 'test', kind: 'stop' }),
      maxAttempts: () => 1,
      resolveRetryBudget: () => 0,
    },
    runAttempt: vi.fn(async ({ context }: LLMAttemptInput) => {
      const toolsOffered = (context.resolvedTools?.tools.length ?? 0) > 0;
      toolsOfferedByTurn.push(toolsOffered);
      return { ok: true as const, output: model(toolsOfferedByTurn.length, toolsOffered) };
    }),
    stream: vi.fn(),
  } as any;

  const agent = new GeneralChatAgent({
    agentConfig: {},
    modelRuntimeConfig: { model: 'gpt-6.2-sol', provider: 'openai' },
    operationId: 'op-1',
  });
  const runtime = new AgentRuntime(agent, {
    executors: createAgentRuntimeExecutors(fixture.host),
  });

  let state: AgentState = createState({
    maxSteps: undefined,
    messages: [{ content: 'What do you remember about me?', id: 'msg-user', role: 'user' }],
    modelRuntimeConfig: { model: 'gpt-6.2-sol', provider: 'openai' },
    toolManifestMap: {
      'lobe-local-system': {
        api: [{ description: '', humanIntervention: 'never', name: 'readFile', parameters: {} }],
        identifier: 'lobe-local-system',
        meta: {},
        type: 'builtin',
      },
      'lobe-user-memory': {
        api: [
          { description: '', humanIntervention: 'never', name: 'searchUserMemory', parameters: {} },
        ],
        identifier: 'lobe-user-memory',
        meta: {},
        type: 'builtin',
      },
      'mcp-jobs': {
        api: [
          { description: '', humanIntervention: 'never', name: 'getJobStatus', parameters: {} },
        ],
        identifier: 'mcp-jobs',
        meta: {},
        type: 'default',
      },
    } as any,
    ...seed,
  });
  let context: AgentRuntimeContext | undefined = {
    payload: {},
    phase: 'user_input',
    session: { messageCount: 1, sessionId: 'op-1', status: 'running', stepCount: 0 },
  };
  const events: AgentEvent[] = [];

  for (let step = 0; context && state.status === 'running' && step < maxTurns * 3; step++) {
    const result = await runtime.step(state, context);
    events.push(...result.events);
    state = result.newState;
    context = result.nextContext;
  }

  const dispatched = fixture.runTool.mock.calls.map(([call]) => call as ChatToolPayload);
  const lastContent = updates.mock.calls
    .map(([, value]) => (value as { content?: string }).content)
    .findLast((content) => content !== undefined);

  return { dispatched, done: events.at(-1), events, lastContent, state, toolsOfferedByTurn };
};

describe('per-operation tool call budget (GH #23657)', () => {
  it('stops a one-call-per-turn varied-argument search loop and lets the model answer', async () => {
    const { dispatched, done, events, lastContent, state, toolsOfferedByTurn } = await replay(
      (turn, toolsOffered) =>
        toolsOffered ? output('', [searchCall(turn)]) : output('Here is what I found.', []),
    );

    // Dispatch is cut exactly at the budget, and every call really was different.
    expect(dispatched).toHaveLength(TOOL_CALL_BUDGET_PER_OPERATION);
    expect(new Set(dispatched.map((call) => call.arguments)).size).toBe(
      TOOL_CALL_BUDGET_PER_OPERATION,
    );
    // One more model turn, with tools removed, turns the results into the reply.
    expect(toolsOfferedByTurn).toHaveLength(TOOL_CALL_BUDGET_PER_OPERATION + 1);
    expect(toolsOfferedByTurn.at(-1)).toBe(false);
    expect(lastContent).toBe('Here is what I found.');

    expect(state.status).toBe('done');
    expect(state.toolCallBudget).toMatchObject({
      counts: { [SEARCH_TOOL]: TOOL_CALL_BUDGET_PER_OPERATION },
      exhaustedTool: SEARCH_TOOL,
      stoppedByBudget: true,
    });
    expect(done).toMatchObject({ reason: 'tool_call_budget_exceeded', type: 'done' });
    expect((done as { reason?: string }).reason).not.toBe('ExceededContextWindow');
    expect(events.find((event) => event.type === 'error')).toBeUndefined();
  });

  it('still ends readably when the model never produces text, even with tools removed', async () => {
    const { dispatched, done, lastContent, state, toolsOfferedByTurn } = await replay((turn) =>
      output('', [searchCall(turn)]),
    );

    expect(dispatched).toHaveLength(TOOL_CALL_BUDGET_PER_OPERATION);
    expect(toolsOfferedByTurn).toHaveLength(TOOL_CALL_BUDGET_PER_OPERATION + 1);
    expect(lastContent).toBe(toolCallBudgetStopNote(SEARCH_TOOL));
    expect(state.status).toBe('done');
    expect(done).toMatchObject({ reason: 'tool_call_budget_exceeded', type: 'done' });
    expect((done as { reason?: string }).reason).not.toBe('ExceededContextWindow');
  });

  it('dispatches only the calls that fit when one turn crosses the budget', async () => {
    const already = TOOL_CALL_BUDGET_PER_OPERATION - 2;
    const { dispatched, done } = await replay(
      (turn, toolsOffered) =>
        toolsOffered
          ? output('', [
              ...Array.from({ length: 5 }, (_, index) => searchCall(turn, index)),
              toolCall('lobe-local-system', 'readFile', `read-${turn}`, { path: 'a.md' }),
            ])
          : output('Answer.', []),
      { toolCallBudget: { counts: { [SEARCH_TOOL]: already } } },
    );

    expect(dispatched.filter((call) => call.apiName === 'searchUserMemory')).toHaveLength(2);
    expect(dispatched.filter((call) => call.apiName === 'readFile')).toHaveLength(1);
    expect(done).toMatchObject({ reason: 'tool_call_budget_exceeded' });
  });

  it.each([
    ['MCP job-status polling', 'mcp-jobs', 'getJobStatus'],
    ['workspace file reads', 'lobe-local-system', 'readFile'],
  ])('does not budget %s', async (_label, identifier, apiName) => {
    const turns = TOOL_CALL_BUDGET_PER_OPERATION + 10;
    const { dispatched, done, state } = await replay((turn) =>
      turn <= turns
        ? output('', [toolCall(identifier, apiName, `call-${turn}`, { cursor: turn })])
        : output('Finished.', []),
    );

    expect(dispatched).toHaveLength(turns);
    expect(state.toolCallBudget?.stoppedByBudget).toBeUndefined();
    expect(done).toMatchObject({ reason: 'completed', type: 'done' });
  });

  it('leaves the repeat and burst guards in charge of their own stops', async () => {
    const repeated = await replay((turn) =>
      turn <= TOOL_CALL_REPEAT_LIMIT
        ? output('', [
            toolCall('lobe-user-memory', 'searchUserMemory', `same-${turn}`, { queries: ['x'] }),
          ])
        : output('unreachable', []),
    );
    expect(repeated.dispatched).toHaveLength(TOOL_CALL_REPEAT_LIMIT - 1);
    expect(repeated.state.toolCallRepeatGuard?.stoppedByRepeatLimit).toBe(true);
    expect(repeated.state.toolCallBudget?.stoppedByBudget).toBeUndefined();

    const burst = await replay(() =>
      output(
        '',
        Array.from({ length: TOOL_CALL_BURST_LIMIT + 1 }, (_, index) => searchCall(1, index)),
      ),
    );
    expect(burst.dispatched).toHaveLength(0);
    expect(burst.state.toolCallRepeatGuard?.stoppedByRepeatLimit).toBe(true);
    expect(burst.state.toolCallBudget).toBeUndefined();
  });
});

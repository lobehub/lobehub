import type { ChatToolPayload } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { AgentRuntime } from '../../core/runtime';
import { finalizeCallLlmTurn } from '../../executors/callLlmFinalizer';
import type { AgentRuntimeHost, LLMAttemptOutput } from '../../transport';
import type { AgentInstruction, AgentRuntimeContext, AgentState } from '../../types';
import {
  buildToolCallBudgetContent,
  TOOL_CALL_BUDGET_FEEDBACK_LIMIT,
  TOOL_CALL_BUDGET_REASON,
} from '../../utils/toolCallRepeatGuard';
import { GeneralChatAgent } from '../GeneralChatAgent';

/**
 * Scenario tests for `maxCallsPerOperation`: a budgeted API called past its
 * budget is answered with a rejected tool row instead of being dispatched, and
 * a model that keeps asking is stopped. Pure-helper unit tests live beside the
 * module in `utils/toolCallRepeatGuard.test.ts`.
 */
describe('GeneralChatAgent tool call budget (llm_result phase)', () => {
  const BUDGET = 20;

  const toolManifestMap = {
    'lobe-local-system': {
      api: [{ name: 'readFile', parameters: { properties: {}, type: 'object' } }],
      identifier: 'lobe-local-system',
    },
    'lobe-user-memory': {
      api: [
        {
          maxCallsPerOperation: BUDGET,
          name: 'searchUserMemory',
          parameters: { properties: {}, type: 'object' },
        },
      ],
      identifier: 'lobe-user-memory',
    },
  };

  const createAgent = () =>
    new GeneralChatAgent({
      agentConfig: { maxSteps: 1000 },
      modelRuntimeConfig: { model: 'gpt-4o-mini', provider: 'openai' },
      operationId: 'operation-1',
    });

  const createState = () =>
    AgentRuntime.createInitialState({
      operationId: 'operation-1',
      status: 'running',
      toolManifestMap,
      // Auto-run keeps the scenario on dispatch vs. rejection; approval is a
      // separate branch with its own tests.
      userInterventionConfig: { approvalMode: 'auto-run' },
    });

  const createHost = (): AgentRuntimeHost => ({
    operation: { operationId: 'operation-1', stepIndex: 0 },
    transports: {
      messages: {
        createAssistantMessage: vi.fn(),
        createToolMessage: vi.fn(),
        deleteMessage: vi.fn(),
        findById: vi.fn(),
        findToolMessageIdByToolCallId: vi.fn(),
        getToolMessage: vi.fn(),
        query: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
        updatePluginState: vi.fn(),
        updateToolIntervention: vi.fn(),
        updateToolMessage: vi.fn(),
      },
      stream: {
        publishChunk: vi.fn(),
        publishError: vi.fn(),
        publishEvent: vi.fn().mockResolvedValue(undefined),
      },
    },
  });

  const searchCall = (index: number): ChatToolPayload => ({
    apiName: 'searchUserMemory',
    // A new query every call: the argument-keyed repeat guard never sees a repeat.
    arguments: JSON.stringify({ queries: [`rephrased question ${index}`] }),
    id: `search-${index}`,
    identifier: 'lobe-user-memory',
    type: 'builtin',
  });

  const readFileCall = (index: number): ChatToolPayload => ({
    apiName: 'readFile',
    arguments: JSON.stringify({ path: `/repo/file-${index}.ts` }),
    id: `read-${index}`,
    identifier: 'lobe-local-system',
    type: 'builtin',
  });

  /** One LLM turn that asks for `toolsCalling` and writes no text. */
  const runTurn = async (state: AgentState, toolsCalling: ChatToolPayload[], turn: number) => {
    const output: LLMAttemptOutput = {
      answerSalvagedFromReasoning: false,
      content: '',
      contentParts: [],
      grounding: null,
      hasContentImages: false,
      hasReasoningImages: false,
      imageList: [],
      reasoningParts: [],
      thinkingContent: '',
      toolCalls: toolsCalling.map((tool) => ({
        function: { arguments: tool.arguments, name: tool.apiName },
        id: tool.id,
        type: 'function' as const,
      })),
      toolsCalling,
    } as LLMAttemptOutput;

    const finalized = await finalizeCallLlmTurn({
      assistantMessageId: `assistant-${turn}`,
      events: [],
      host: createHost(),
      model: 'gpt-4o-mini',
      output,
      provider: 'openai',
      shouldReplayAssistantReasoning: false,
      state,
    });
    const instructions = [
      await createAgent().runner(finalized.nextContext as AgentRuntimeContext, finalized.newState),
    ].flat() as AgentInstruction[];

    return { finalized, instructions };
  };

  const dispatchedCalls = (instructions: AgentInstruction[]): ChatToolPayload[] =>
    instructions.flatMap((instruction) => {
      if (instruction.type === 'call_tool') return [instruction.payload.toolCalling];
      if (instruction.type === 'call_tools_batch') return instruction.payload.toolsCalling;
      return [];
    });

  const rejectedCalls = (instructions: AgentInstruction[]): ChatToolPayload[] =>
    instructions.flatMap((instruction) =>
      instruction.type === 'resolve_blocked_tools' ? instruction.payload.toolsCalling : [],
    );

  /**
   * @example
   * The reported loop: every model response asks for one more memory search
   * with a rephrased query and never writes an answer. 500 of those ran in one
   * reply. Now 20 run, the next two are rejected with "answer with what you
   * have", and the third ignored rejection ends the run.
   */
  it('stops a model that searches memory with a new query every turn and never answers', async () => {
    let state = createState();
    const dispatched: ChatToolPayload[] = [];
    const rejected: ChatToolPayload[] = [];
    let turns = 0;
    let finished = false;

    // Far above the expected stop, so a missing bound fails the assertions
    // below instead of hanging the suite.
    for (let turn = 0; turn < 200 && !finished; turn++) {
      const { finalized, instructions } = await runTurn(state, [searchCall(turn)], turn);
      state = finalized.newState;
      turns += 1;
      dispatched.push(...dispatchedCalls(instructions));
      rejected.push(...rejectedCalls(instructions));
      finished = instructions.some((instruction) => instruction.type === 'finish');
    }

    expect(finished).toBe(true);
    expect(dispatched).toHaveLength(BUDGET);
    expect(rejected).toHaveLength(TOOL_CALL_BUDGET_FEEDBACK_LIMIT);
    expect(turns).toBe(BUDGET + TOOL_CALL_BUDGET_FEEDBACK_LIMIT + 1);
    expect(state.toolCallRepeatGuard?.stoppedByRepeatLimit).toBe(true);
    expect(state.messages.at(-1)).toMatchObject({
      content: `Stopped after searchUserMemory kept being called past its limit of ${BUDGET} calls.`,
      role: 'assistant',
    });
  });

  it('rejects the call past the budget with guidance to answer, without ending the run', async () => {
    let state = createState();
    for (let turn = 0; turn < BUDGET; turn++) {
      state = (await runTurn(state, [searchCall(turn)], turn)).finalized.newState;
    }

    const overBudget = searchCall(BUDGET);
    const { finalized, instructions } = await runTurn(state, [overBudget], BUDGET);

    expect(instructions).toEqual([
      {
        payload: {
          blockedContentByCallId: {
            [overBudget.id]: buildToolCallBudgetContent(overBudget, BUDGET),
          },
          blockedReason: TOOL_CALL_BUDGET_REASON,
          parentMessageId: `assistant-${BUDGET}`,
          toolsCalling: [overBudget],
        },
        type: 'resolve_blocked_tools',
      },
    ]);
    expect(finalized.newState.toolCallRepeatGuard?.stoppedByRepeatLimit).toBeUndefined();
  });

  it('runs the calls that fit the budget and the unbudgeted calls of a turn that overshoots', async () => {
    const batch = [
      ...Array.from({ length: BUDGET + 2 }, (_, index) => searchCall(index)),
      readFileCall(0),
    ];

    const { instructions } = await runTurn(createState(), batch, 0);

    expect(rejectedCalls(instructions).map((call) => call.id)).toEqual([
      `search-${BUDGET}`,
      `search-${BUDGET + 1}`,
    ]);
    expect(dispatchedCalls(instructions).map((call) => call.id)).toEqual([
      ...Array.from({ length: BUDGET }, (_, index) => `search-${index}`),
      'read-0',
    ]);
  });

  it('keeps the run going when the model moves on after a rejection', async () => {
    let state = createState();
    for (let turn = 0; turn < BUDGET; turn++) {
      state = (await runTurn(state, [searchCall(turn)], turn)).finalized.newState;
    }

    // Two rejected rounds, a turn on another tool, then two more rejected
    // rounds: never three in a row, so the run is not stopped.
    const turns = [
      [searchCall(100)],
      [searchCall(101)],
      [readFileCall(0)],
      [searchCall(102)],
      [searchCall(103)],
    ];
    for (const [index, toolsCalling] of turns.entries()) {
      const { finalized, instructions } = await runTurn(state, toolsCalling, BUDGET + index);
      state = finalized.newState;
      expect(instructions.some((instruction) => instruction.type === 'finish')).toBe(false);
    }

    expect(state.toolCallRepeatGuard?.stoppedByRepeatLimit).toBeUndefined();
  });

  it('never limits an API that declares no budget', async () => {
    let state = createState();

    for (let turn = 0; turn < BUDGET * 3; turn++) {
      const call = readFileCall(turn);
      const { finalized, instructions } = await runTurn(state, [call], turn);
      state = finalized.newState;
      expect(dispatchedCalls(instructions)).toEqual([call]);
    }

    expect(state.toolCallRepeatGuard?.apiCalls).toBeUndefined();
  });
});

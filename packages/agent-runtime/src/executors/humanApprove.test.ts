import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeHost } from '../transport';
import type { AgentInstruction, AgentState } from '../types';
import { requestHumanApprove } from './humanApprove';

const createState = (overrides?: Partial<AgentState>): AgentState => ({
  cost: {
    calculatedAt: '2026-07-26T00:00:00.000Z',
    currency: 'USD',
    llm: { byModel: [], currency: 'USD', total: 0 },
    tools: { byTool: [], currency: 'USD', total: 0 },
    total: 0,
  },
  createdAt: '2026-07-26T00:00:00.000Z',
  lastModified: '2026-07-26T00:00:00.000Z',
  maxSteps: 100,
  messages: [],
  metadata: {
    agentId: 'agent-1',
    threadId: undefined,
    topicId: 'topic-1',
  },
  operationId: 'op-1',
  status: 'running',
  stepCount: 0,
  toolManifestMap: {},
  usage: {
    humanInteraction: {
      approvalRequests: 0,
      promptRequests: 0,
      selectRequests: 0,
      totalWaitingTimeMs: 0,
    },
    llm: { apiCalls: 0, processingTimeMs: 0, tokens: { input: 0, output: 0, total: 0 } },
    tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 },
  },
  ...overrides,
});

const pendingTool = {
  apiName: 'askUserQuestion',
  arguments: '{}',
  id: 'call_ask_1',
  identifier: 'lobe-agent',
  type: 'builtin' as const,
};

describe('requestHumanApprove', () => {
  let createToolMessage: ReturnType<typeof vi.fn>;
  let deleteMessage: ReturnType<typeof vi.fn>;
  let query: ReturnType<typeof vi.fn>;
  let host: AgentRuntimeHost;

  beforeEach(() => {
    createToolMessage = vi.fn().mockResolvedValue({ id: 'tool-msg-1' });
    deleteMessage = vi.fn().mockResolvedValue(undefined);
    query = vi.fn().mockResolvedValue([]);

    host = {
      lifecycle: { dispatch: vi.fn().mockResolvedValue(undefined) },
      operation: {
        agentId: 'agent-1',
        operationId: 'op-1',
        stepIndex: 1,
        topicId: 'topic-1',
      },
      transports: {
        messages: { createToolMessage, deleteMessage, query },
        stream: { publishChunk: vi.fn(), publishEvent: vi.fn() },
      },
    } as unknown as AgentRuntimeHost;
  });

  /**
   * The shape `state.messages` has after an op crosses a step boundary:
   * `AgentStateManager` strips `messages` before persisting, and the reload runs
   * them through `parse()`, which folds the assistant that carries tool calls
   * into an `assistantGroup` (same id, different role). The previous turn stays
   * a plain `assistant`.
   */
  const rehydratedMessages = [
    { content: 'previous answer', id: 'assistant-previous', role: 'assistant' },
    {
      children: [],
      content: '',
      groupId: 'group-1',
      id: 'assistant-current',
      role: 'assistantGroup',
    },
  ] as unknown as AgentState['messages'];

  /**
   * Regression: scanning `state.messages` for the last `role: 'assistant'` skips
   * the rehydrated `assistantGroup` that actually owns these tool calls and
   * lands on the previous turn, so the pending tool row was persisted under the
   * wrong assistant and the UI flagged it as an orphaned tool call.
   */
  it('parents pending tool messages on the instruction parentMessageId, not the last plain assistant in state', async () => {
    const instruction: Extract<AgentInstruction, { type: 'request_human_approve' }> = {
      parentMessageId: 'assistant-current',
      pendingToolsCalling: [pendingTool],
      type: 'request_human_approve',
    };

    await requestHumanApprove(host)(instruction, createState({ messages: rehydratedMessages }));

    expect(createToolMessage).toHaveBeenCalledTimes(1);
    expect(createToolMessage.mock.calls[0][0]).toMatchObject({
      // The assistantGroup, NOT `assistant-previous`.
      parentId: 'assistant-current',
      tool_call_id: 'call_ask_1',
    });
  });

  it('reads groupId off the rehydrated assistantGroup when the operation carries none', async () => {
    const instruction: Extract<AgentInstruction, { type: 'request_human_approve' }> = {
      parentMessageId: 'assistant-current',
      pendingToolsCalling: [pendingTool],
      type: 'request_human_approve',
    };

    await requestHumanApprove(host)(instruction, createState({ messages: rehydratedMessages }));

    expect(createToolMessage.mock.calls[0][0]).toMatchObject({ groupId: 'group-1' });
  });

  it('falls back to the last assistant in state when no parentMessageId is carried', async () => {
    const instruction: Extract<AgentInstruction, { type: 'request_human_approve' }> = {
      pendingToolsCalling: [pendingTool],
      type: 'request_human_approve',
    };

    const state = createState({
      messages: [
        { content: 'previous answer', id: 'assistant-previous', role: 'assistant' },
      ] as AgentState['messages'],
    });

    await requestHumanApprove(host)(instruction, state);

    expect(createToolMessage.mock.calls[0][0]).toMatchObject({ parentId: 'assistant-previous' });
  });

  it('does not create tool messages on the resume path', async () => {
    const instruction: Extract<AgentInstruction, { type: 'request_human_approve' }> = {
      parentMessageId: 'assistant-current',
      pendingToolsCalling: [pendingTool],
      skipCreateToolMessage: true,
      type: 'request_human_approve',
    };

    query.mockResolvedValue([
      { id: 'tool-msg-existing', role: 'tool', tool_call_id: 'call_ask_1' },
    ]);

    await requestHumanApprove(host)(instruction, createState());

    expect(createToolMessage).not.toHaveBeenCalled();
    expect(
      (host.transports.stream.publishChunk as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toMatchObject({ toolMessageIds: { call_ask_1: 'tool-msg-existing' } });
  });
  describe('unconsumed assistant placeholder', () => {
    // A resume op (approve / answer) seeds an assistant placeholder so the UI
    // shows a spinner, and the first `call_llm` claims it. Parking here means no
    // `call_llm` ran — the approved tool executed and the batch still has
    // unresolved siblings — so the placeholder would linger as an empty "…"
    // assistant hanging off the tool that was just settled.
    const instruction = {
      parentMessageId: 'assistant-msg-1',
      pendingToolsCalling: [pendingTool],
      skipCreateToolMessage: true,
      type: 'request_human_approve',
    } as unknown as AgentInstruction;

    it('retires the seeded placeholder when the run parks without calling the LLM', async () => {
      const result = await requestHumanApprove(host)(
        instruction,
        createState({ pendingAssistantMessageId: 'assistant-placeholder-1' }),
        undefined as any,
      );

      expect(deleteMessage).toHaveBeenCalledWith('assistant-placeholder-1');
      expect(result.newState.pendingAssistantMessageId).toBeUndefined();
      expect(result.newState.status).toBe('waiting_for_human');
    });

    it('parks normally when no placeholder was seeded', async () => {
      const result = await requestHumanApprove(host)(instruction, createState(), undefined as any);

      expect(deleteMessage).not.toHaveBeenCalled();
      expect(result.newState.status).toBe('waiting_for_human');
    });

    it('still parks when retiring the placeholder fails', async () => {
      deleteMessage.mockRejectedValue(new Error('db down'));

      const result = await requestHumanApprove(host)(
        instruction,
        createState({ pendingAssistantMessageId: 'assistant-placeholder-1' }),
        undefined as any,
      );

      expect(result.newState.status).toBe('waiting_for_human');
      expect(result.newState.pendingToolsCalling).toEqual([pendingTool]);
    });
  });
});

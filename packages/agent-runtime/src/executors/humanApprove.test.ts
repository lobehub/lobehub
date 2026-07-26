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
  let query: ReturnType<typeof vi.fn>;
  let host: AgentRuntimeHost;

  beforeEach(() => {
    createToolMessage = vi.fn().mockResolvedValue({ id: 'tool-msg-1' });
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
        messages: { createToolMessage, query },
        stream: { publishChunk: vi.fn(), publishEvent: vi.fn() },
      },
    } as unknown as AgentRuntimeHost;
  });

  /**
   * Regression: `state.messages` is the call_llm INPUT context, so it holds the
   * PREVIOUS turn's assistant but never the one that emitted these tool calls.
   * Resolving the parent by scanning it persisted the pending tool row under the
   * wrong assistant, and the UI then flagged it as an orphaned tool call.
   */
  it('parents pending tool messages on the instruction parentMessageId, not the last assistant in state', async () => {
    const instruction: Extract<AgentInstruction, { type: 'request_human_approve' }> = {
      parentMessageId: 'assistant-current',
      pendingToolsCalling: [pendingTool],
      type: 'request_human_approve',
    };

    const state = createState({
      messages: [
        { content: 'previous answer', id: 'assistant-previous', role: 'assistant' },
      ] as AgentState['messages'],
    });

    await requestHumanApprove(host)(instruction, state);

    expect(createToolMessage).toHaveBeenCalledTimes(1);
    expect(createToolMessage.mock.calls[0][0]).toMatchObject({
      parentId: 'assistant-current',
      tool_call_id: 'call_ask_1',
    });
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
});

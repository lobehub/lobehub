import { expect, it, vi } from 'vitest';

import type { AgentRuntimeHost } from '../transport';
import type { AgentState } from '../types';
import { callTool } from './tool';

it('persists the exact pending message for each assistant step, replacing an earlier reused id', async () => {
  const host = {
    operation: { operationId: 'op', stepIndex: 2 },
    transports: {
      messages: { query: vi.fn().mockResolvedValue([]), findToolMessageIdByToolCallId: vi.fn() },
      stream: { publishChunk: vi.fn(), publishEvent: vi.fn() },
      tools: {
        getCost: () => 0,
        run: vi.fn().mockResolvedValue({
          attempts: 1,
          result: {
            content: '',
            deferred: true,
            success: true,
            state: { status: 'pending', toolMessageId: 'new-row' },
          },
        }),
      },
    },
  } as unknown as AgentRuntimeHost;
  const state = {
    operationId: 'op',
    status: 'running',
    messages: [],
    toolManifestMap: {},
    usage: { tools: { byTool: [], totalCalls: 0, totalTimeMs: 0 } },
    cost: {
      tools: { byTool: [], currency: 'USD', total: 0 },
      llm: { byModel: [], total: 0 },
      total: 0,
    },
    pendingToolMessageIds: { call_1: 'old-row' },
  } as unknown as AgentState;
  const result = await callTool(host)(
    {
      type: 'call_tool',
      payload: {
        parentMessageId: 'assistant-two',
        toolCalling: {
          id: 'call_1',
          identifier: 'fixture',
          apiName: 'form',
          arguments: '{}',
          type: 'mcp',
        },
      },
    },
    state,
  );
  expect(result.newState.pendingToolMessageIds).toEqual({ call_1: 'new-row' });
  expect(result.newState.status).toBe('waiting_for_async_tool');
  expect(state.pendingToolMessageIds).toEqual({ call_1: 'old-row' });
});

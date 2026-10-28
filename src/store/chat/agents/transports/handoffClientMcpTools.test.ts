import type { AgentRuntimeHost, AgentState } from '@lobechat/agent-runtime';
import { describe, expect, it, vi } from 'vitest';

import type { ChatStore } from '@/store/chat/store';

import { handoffClientMcpTools } from './handoffClientMcpTools';

const tool = {
  id: 'call_1',
  identifier: 'fixture',
  apiName: 'form',
  arguments: '{"zero":0}',
  type: 'mcp' as const,
};
function fixture(assistantMessageId = 'assistant-one') {
  const rows: unknown[] = [];
  const messages = {
    findById: vi.fn().mockResolvedValue({ id: assistantMessageId, role: 'assistant' }),
    createToolMessage: vi.fn(async (params) => {
      rows.push(params);
      return { id: `row-${assistantMessageId}-${rows.length}` };
    }),
    updateToolIntervention: vi.fn(),
  };
  const host = {
    operation: { operationId: 'client-only', agentId: 'agent', topicId: 'topic' },
    transports: { messages },
  } as unknown as AgentRuntimeHost;
  const executeGatewayAgent = vi.fn().mockResolvedValue({ success: true });
  const store = {
    operations: { 'client-only': { context: { agentId: 'agent', topicId: 'topic' } } },
    executeGatewayAgent,
  } as unknown as ChatStore;
  return { host, store, messages, executeGatewayAgent, rows };
}
describe('client MCP durable handoff', () => {
  it('persists the exact client invocation then parks its loop while the existing approval continuation owns execution', async () => {
    const { host, store, messages, executeGatewayAgent } = fixture();
    const state = {
      status: 'running',
      pendingToolMessageIds: { call_1: 'earlier' },
    } as unknown as AgentState;
    const result = await handoffClientMcpTools(
      host,
      { type: 'call_tool', payload: { parentMessageId: 'assistant-one', toolCalling: tool } },
      state,
      () => store,
    );
    expect(messages.createToolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: 'assistant-one',
        tool_call_id: 'call_1',
        plugin: tool,
        pluginIntervention: { status: 'pending' },
      }),
    );
    expect(executeGatewayAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeApprovals: [
          { decision: 'approved', parentMessageId: 'row-assistant-one-1', toolCallId: 'call_1' },
        ],
      }),
    );
    expect(result).toMatchObject({
      events: [],
      newState: { status: 'waiting_for_human', pendingToolMessageIds: undefined },
    });
    expect(state.status).toBe('running');
  });
  it('hands a mixed approved batch over once, retaining original ids and arguments', async () => {
    const { host, store, messages, executeGatewayAgent } = fixture();
    const builtin = { ...tool, id: 'call_2', type: 'builtin' as const };
    await handoffClientMcpTools(
      host,
      {
        type: 'call_tools_batch',
        payload: { parentMessageId: 'assistant-one', toolsCalling: [tool, builtin] },
      },
      {} as AgentState,
      () => store,
    );
    expect(messages.createToolMessage).toHaveBeenCalledTimes(2);
    expect(executeGatewayAgent).toHaveBeenCalledOnce();
    expect(executeGatewayAgent.mock.calls[0][0].resumeApprovals.map((x) => x.toolCallId)).toEqual([
      'call_1',
      'call_2',
    ]);
  });
  it('does not hand off ordinary client tools or report a failed start as a completed invocation', async () => {
    const { host, store, executeGatewayAgent } = fixture();
    expect(
      await handoffClientMcpTools(
        host,
        {
          type: 'call_tool',
          payload: { parentMessageId: 'assistant-one', toolCalling: { ...tool, type: 'builtin' } },
        },
        {} as AgentState,
        () => store,
      ),
    ).toBeUndefined();
    expect(executeGatewayAgent).not.toHaveBeenCalled();
    executeGatewayAgent.mockResolvedValue({ success: false, error: 'queue unavailable' });
    await expect(
      handoffClientMcpTools(
        host,
        { type: 'call_tool', payload: { parentMessageId: 'assistant-one', toolCalling: tool } },
        {} as AgentState,
        () => store,
      ),
    ).rejects.toThrow('queue unavailable');
  });
});

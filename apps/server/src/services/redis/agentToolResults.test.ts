// @vitest-environment node
import { mcpInvocationKey, mcpTransportCallId } from '@lobechat/mcp-elicitation/transport';
import { expect, it, vi } from 'vitest';

import { dispatchClientTool } from '@/server/modules/AgentRuntime/dispatchClientTool';

import { agentToolResults } from './agentToolResults';

const state = vi.hoisted(() => ({ redis: undefined as any }));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: () => state.redis,
}));
it('waits and first-delivers independently for reused ids across assistant steps and actors', async () => {
  const claims = new Map<string, string>(),
    queues = new Map<string, string[]>(),
    waiters = new Map<string, (v: [string, string]) => void>();
  const popped: string[] = [];
  state.redis = {
    eval: vi.fn(async (_script: string, numKeys: number, ...args: string[]) => {
      if (numKeys === 1) {
        if (claims.has(args[0])) return claims.get(args[0]) === args[1] ? 1 : 0;
        claims.set(args[0], args[1]);
        return 1;
      }
      const [dedupe, key, payload] = args;
      if (claims.has(dedupe)) return 0;
      claims.set(dedupe, '1');
      const waiter = waiters.get(key);
      if (waiter) {
        waiters.delete(key);
        waiter([key, payload]);
      } else queues.set(key, [...(queues.get(key) ?? []), payload]);
      return 1;
    }),
    duplicate: () => ({
      disconnect: vi.fn(),
      blpop: async (key: string) => {
        popped.push(key);
        const queued = queues.get(key);
        const ready = queued?.shift();
        if (queued?.length === 0) queues.delete(key);
        return ready ? [key, ready] : new Promise((resolve) => waiters.set(key, resolve));
      },
    }),
  };
  const base = {
    userId: 'alice',
    operationId: 'same-op',
    assistantMessageId: 'assistant-one',
    toolCallId: 'call_1',
  };
  const scopes = [
    base,
    { ...base, assistantMessageId: 'assistant-two' },
    { ...base, userId: 'bob' },
    { ...base, workspaceId: 'other-workspace' },
    { ...base, operationId: 'other-operation' },
  ];
  const wires: string[] = [];
  const waiting = scopes.map((scope) =>
    dispatchClientTool(
      {
        id: scope.toolCallId,
        type: 'mcp',
        identifier: 'fixture',
        apiName: 'form',
        arguments: '{}',
      },
      {
        ...scope,
        streamManager: {
          sendToolExecute: async (_op: string, data: any) => {
            wires.push(data.toolCallId);
          },
        } as any,
      },
    ),
  );
  for (const scope of scopes.toReversed()) {
    await agentToolResults.publishMcpResult(scope, {
      toolCallId: 'call_1',
      content: mcpInvocationKey(scope),
      success: true,
    });
    await agentToolResults.publishMcpResult(scope, {
      toolCallId: 'call_1',
      content: 'duplicate must not replace',
      success: true,
    });
  }
  const results = await Promise.all(waiting);
  expect(results.map((r) => r.content)).toEqual(scopes.map(mcpInvocationKey));
  expect(new Set(wires).size).toBe(scopes.length);
  expect(popped).toEqual(scopes.map((s) => 'tool_result:' + mcpTransportCallId(s)));
  expect(queues.size).toBe(0);
});

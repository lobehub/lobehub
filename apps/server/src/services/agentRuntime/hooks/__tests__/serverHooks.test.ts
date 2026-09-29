// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HookDispatcher } from '../HookDispatcher';
import type { AgentHook, ToolCallHookEvent } from '../types';

const { queueMode } = vi.hoisted(() => ({ queueMode: vi.fn(() => false) }));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: queueMode }));
vi.mock('@/libs/qstash', () => ({ OtelQstashClient: class {} }));
vi.mock('@/database/models/user', () => ({ UserModel: { getEmailsByIds: async () => [] } }));
vi.mock('@/database/server', () => ({ getServerDB: async () => ({}) }));

const event: Omit<ToolCallHookEvent, 'mock'> = {
  apiName: 'read',
  assistantMessageId: 'synthetic-message',
  args: { path: 'synthetic.txt' },
  callIndex: 0,
  identifier: 'files',
  executor: 'server',
  operationId: 'synthetic-op',
  stepIndex: 0,
  toolCallId: 'synthetic-tool-call',
  userId: 'synthetic-user',
};

describe('environment hooks through real HTTP transport', () => {
  const requests: { authorization?: string; body: Record<string, unknown>; path?: string }[] = [];
  let response: unknown;
  const receiver = createServer(async (request, reply) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString()),
      path: request.url,
    });
    reply.setHeader('content-type', 'application/json');
    reply.end(JSON.stringify(response));
  });
  let url: string;

  beforeEach(async () => {
    requests.length = 0;
    response = {
      hookSpecificOutput: { hookEventName: 'beforeToolCall', permissionDecision: 'allow' },
    };
    queueMode.mockReturnValue(false);
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/ingress`;
    vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', url);
    vi.stubEnv('AGENT_HOOK_WEBHOOK_TOKEN', 'synthetic-secret-one');
    vi.stubEnv(
      'AGENT_HOOK_WEBHOOK_EVENTS',
      'beforeToolCall, afterToolCall, onToolCallError,beforeToolCall',
    );
    vi.stubEnv('AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING', 'toolCall');
    vi.stubEnv('AGENT_HOOK_WEBHOOK_ON_ERROR', 'block');
  });
  afterEach(async () => {
    receiver.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      receiver.close((error) => (error ? reject(error) : resolve())),
    );
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    'persists templates, separates controls and notifications, restores once in queue=%s',
    async (queue) => {
      queueMode.mockReturnValue(queue);
      const dispatcher = new HookDispatcher();
      dispatcher.register(event.operationId, []);
      dispatcher.register(event.operationId, []);
      const saved = JSON.stringify(dispatcher.getSerializedHooks(event.operationId));
      expect(saved).not.toContain('synthetic-secret-one');
      const hooks = JSON.parse(saved);
      expect(hooks).toHaveLength(3);
      expect(hooks[0].webhook).toEqual({
        allowedEnvVars: ['AGENT_HOOK_WEBHOOK_TOKEN'],
        delivery: 'fetch',
        headers: { Authorization: 'Bearer ${AGENT_HOOK_WEBHOOK_TOKEN}' },
        onError: 'block',
        responseHandling: 'toolCall',
        url,
      });
      for (const hook of hooks.slice(1))
        expect(hook.webhook).toMatchObject({ onError: 'continue', responseHandling: 'ignore' });

      // A cold worker needs only the persisted configs and its own token.
      vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', undefined);
      vi.stubEnv('AGENT_HOOK_WEBHOOK_TOKEN', 'synthetic-secret-two');
      const cold = new HookDispatcher();
      const restored = [...hooks, ...hooks];
      await cold.dispatchBeforeToolCall(event.operationId, event, restored);
      expect(requests).toHaveLength(0);
      expect(await cold.evaluateToolCall(event.operationId, event, restored)).toMatchObject({
        status: 'allow',
      });
      response = {
        hookSpecificOutput: { hookEventName: 'beforeToolCall', permissionDecision: 'deny' },
      };
      expect(await cold.evaluateToolCall(event.operationId, event, restored)).toMatchObject({
        status: 'blocked',
      });
      await cold.dispatch(
        event.operationId,
        'afterToolCall',
        { ...event, executionTimeMs: 1, mocked: true, result: { content: 'safe', success: true } },
        restored,
      );
      await cold.dispatch(
        event.operationId,
        'onToolCallError',
        { ...event, error: 'synthetic' },
        restored,
      );
      expect(requests).toHaveLength(4);
      expect(requests.map((request) => request.body.hookType)).toEqual([
        'beforeToolCall',
        'beforeToolCall',
        'afterToolCall',
        'onToolCallError',
      ]);
      expect(
        requests.every((request) => request.authorization === 'Bearer synthetic-secret-two'),
      ).toBe(true);
      expect(requests[2].body).toMatchObject({ mocked: true, result: { content: 'safe' } });
      expect(JSON.stringify(requests.map((request) => request.body))).not.toContain(
        'synthetic-secret',
      );
      expect(queueMode()).toBe(queue);
    },
  );

  it('preserves caller handlers and internal callbacks and prevents same-ID replacement', async () => {
    const dispatcher = new HookDispatcher();
    const handler = vi.fn();
    const original: AgentHook[] = [
      { id: 'internal-callback', type: 'afterToolCall', webhook: { url: `${url}/internal` } },
      { id: 'caller-handler', type: 'afterToolCall', handler },
    ];
    dispatcher.register(event.operationId, original);
    const id = dispatcher
      .getSerializedHooks(event.operationId)!
      .find((hook) => hook.type === 'beforeToolCall')!.id;
    const replacement = vi.fn();
    dispatcher.register(event.operationId, [{ id, type: 'beforeToolCall', handler: replacement }]);
    await dispatcher.dispatchBeforeToolCall(event.operationId, event);
    expect(replacement).not.toHaveBeenCalled();
    await dispatcher.dispatch(event.operationId, 'afterToolCall', {
      ...event,
      executionTimeMs: 1,
      result: { content: 'ok', success: true },
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(requests.map((request) => request.path)).toEqual(['/ingress/internal', '/ingress']);
    expect(dispatcher.getSerializedHooks(event.operationId)).toHaveLength(4);
  });

  it('rejects invalid deployment configuration instead of silently registering nothing', () => {
    vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', 'beforeToolCall,...');
    const dispatcher = new HookDispatcher();
    expect(() => dispatcher.register(event.operationId, [])).toThrow('AGENT_HOOK_WEBHOOK_EVENTS');
    expect(dispatcher.hasHooks(event.operationId)).toBe(false);
  });

  it('keeps local mock callbacks alongside environment controls', async () => {
    const dispatcher = new HookDispatcher();
    const handler = vi.fn(async (hookEvent) => {
      (hookEvent as ToolCallHookEvent).mock({ content: 'local mock', success: true });
    });
    dispatcher.register(event.operationId, [{ id: 'local-mock', type: 'beforeToolCall', handler }]);
    expect(await dispatcher.evaluateToolCall(event.operationId, event)).toMatchObject({
      status: 'allow',
    });
    expect(await dispatcher.dispatchBeforeToolCall(event.operationId, event)).toEqual({
      isMocked: true,
      result: { content: 'local mock', success: true },
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
  });

  it('defaults to notifications whose response cannot deny a tool', async () => {
    vi.stubEnv('AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING', undefined);
    vi.stubEnv('AGENT_HOOK_WEBHOOK_ON_ERROR', undefined);
    response = {
      hookSpecificOutput: { hookEventName: 'beforeToolCall', permissionDecision: 'deny' },
    };
    const dispatcher = new HookDispatcher();
    dispatcher.register(event.operationId, []);
    expect(await dispatcher.evaluateToolCall(event.operationId, event)).toMatchObject({
      status: 'allow',
    });
    expect(requests).toHaveLength(0);
    expect(await dispatcher.dispatchBeforeToolCall(event.operationId, event)).toBeNull();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
  });

  it('applies current server configuration to an older snapshot without losing its callback', async () => {
    const cold = new HookDispatcher();
    const restored = [
      {
        id: 'internal-callback',
        type: 'afterToolCall' as const,
        webhook: { url: `${url}/internal` },
      },
    ];
    response = {
      hookSpecificOutput: { hookEventName: 'beforeToolCall', permissionDecision: 'deny' },
    };
    expect(await cold.evaluateToolCall(event.operationId, event, restored)).toMatchObject({
      status: 'blocked',
    });
    await cold.dispatch(
      event.operationId,
      'afterToolCall',
      { ...event, executionTimeMs: 1, result: { content: 'ok', success: true } },
      restored,
    );
    expect(requests.map((request) => request.path)).toEqual([
      '/ingress',
      '/ingress/internal',
      '/ingress',
    ]);
  });

  it.each(['continue', 'block'] as const)(
    'applies onError=%s to an invalid control response without leaking credentials',
    async (onError) => {
      vi.stubEnv('AGENT_HOOK_WEBHOOK_ON_ERROR', onError);
      response = { invalid: 'synthetic-secret-two' };
      const log = vi.spyOn(console, 'error');
      const dispatcher = new HookDispatcher();
      dispatcher.register(event.operationId, []);
      const result = await dispatcher.evaluateToolCall(event.operationId, event);
      expect(result.status).toBe(onError === 'block' ? 'blocked' : 'allow');
      expect(
        JSON.stringify({
          result,
          logs: log.mock.calls,
          state: dispatcher.getSerializedHooks(event.operationId),
        }),
      ).not.toContain('synthetic-secret');
    },
  );
});

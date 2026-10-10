// @vitest-environment node
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { serializedAgentHookSchema } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HookDispatcher } from '../HookDispatcher';
import { getServerHooks } from '../serverHooks';
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
  let responseStatus: number;
  const receiver = createServer(async (request, reply) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString()),
      path: request.url,
    });
    reply.statusCode = request.url === '/notification' ? 204 : responseStatus;
    reply.setHeader('content-type', 'application/json');
    reply.end(typeof response === 'string' ? response : JSON.stringify(response));
  });
  let url: string;

  beforeEach(async () => {
    requests.length = 0;
    response = { decision: 'allow' };
    responseStatus = 200;
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
    'uses current config without persisting environment hooks in queue=%s',
    async (queue) => {
      queueMode.mockReturnValue(queue);
      const dispatcher = new HookDispatcher();
      dispatcher.register(event.operationId, []);
      dispatcher.register(event.operationId, []);
      const saved = JSON.stringify(dispatcher.getSerializedHooks(event.operationId));
      expect(saved).not.toContain('synthetic-secret-one');
      expect(JSON.parse(saved)).toEqual([]);
      const hooks = getServerHooks().map((hook) => serializedAgentHookSchema.parse(hook));
      expect(hooks).toHaveLength(3);
      expect(hooks[0].webhook).toEqual({
        allowedEnvVars: ['AGENT_HOOK_WEBHOOK_TOKEN'],
        delivery: 'fetch',
        headers: { Authorization: 'Bearer ${AGENT_HOOK_WEBHOOK_TOKEN}' },
        onError: 'block',
        responseHandling: 'toolCall',
        url,
      });
      expect(hooks[1].webhook).toMatchObject({ onError: 'block', responseHandling: 'toolCall' });
      expect(hooks[2].webhook).toMatchObject({ onError: 'continue', responseHandling: 'ignore' });

      // A cold worker uses its current configuration, ignoring legacy snapshot copies.
      vi.stubEnv('AGENT_HOOK_WEBHOOK_TOKEN', 'synthetic-secret-two');
      const cold = new HookDispatcher();
      const restored = [...hooks, ...hooks];
      await cold.dispatchBeforeToolCall(event.operationId, event, restored);
      expect(requests).toHaveLength(0);
      expect(await cold.evaluateToolCall(event.operationId, event, restored)).toMatchObject({
        status: 'allow',
      });
      response = { decision: 'deny', reason: 'Denied by current env hook' };
      expect(await cold.evaluateToolCall(event.operationId, event, restored)).toEqual({
        reason: 'Denied by current env hook',
        status: 'blocked',
      });
      const after = {
        ...event,
        executionTimeMs: 1,
        mocked: true,
        result: { content: 'safe', success: true },
      };
      expect(await cold.evaluateAfterToolCall(event.operationId, after, restored)).toMatchObject({
        status: 'blocked',
      });
      await cold.dispatch(event.operationId, 'afterToolCall', after, restored);
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

  it.each(['afterToolCall', 'beforeToolCall,afterToolCall'])(
    'checks selected events %s with toolCall without persisting server secrets',
    async (events) => {
      vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', events);
      response = { decision: 'deny' };
      const dispatcher = new HookDispatcher();
      dispatcher.register(event.operationId, []);
      expect(dispatcher.getSerializedHooks(event.operationId)).toEqual([]);
      const after = { ...event, mocked: false, result: { content: 'full result', success: true } };
      expect(await dispatcher.evaluateAfterToolCall(event.operationId, after)).toMatchObject({
        status: 'blocked',
      });
      await dispatcher.dispatch(event.operationId, 'afterToolCall', after);
      expect(requests).toHaveLength(1);
      expect(requests[0].body).toMatchObject({ hookType: 'afterToolCall', result: after.result });
      expect(await dispatcher.evaluateToolCall(event.operationId, event)).toMatchObject({
        status: events.includes('beforeToolCall') ? 'blocked' : 'allow',
      });
      expect(requests).toHaveLength(events.includes('beforeToolCall') ? 2 : 1);
    },
  );

  describe.each(['beforeToolCall', 'afterToolCall'] as const)(
    'optional decisions for %s',
    (type) => {
      const after = { ...event, mocked: false, result: { content: 'full result', success: true } };
      const evaluate = (dispatcher: HookDispatcher) =>
        type === 'beforeToolCall'
          ? dispatcher.evaluateToolCall(event.operationId, event)
          : dispatcher.evaluateAfterToolCall(event.operationId, after);

      it.each([
        [204, ''],
        [200, ''],
        [200, 'not JSON'],
        [200, '{"decision":'],
        [200, {}],
        [200, null],
        [200, [{ decision: 'deny' }]],
        [202, { accepted: true }],
      ] as const)(
        'continues on notification response %i %j even with onError=block',
        async (status, body) => {
          responseStatus = status;
          response = body;
          const dispatcher = new HookDispatcher();
          expect(await evaluate(dispatcher)).toEqual({ status: 'allow' });
          await dispatcher.dispatch(
            event.operationId,
            type,
            type === 'beforeToolCall' ? event : after,
          );
          expect(requests).toHaveLength(1);
          expect(requests[0].body.hookType).toBe(type);
        },
      );

      it.each(['continue', 'block'] as const)(
        'honors onError=%s for delivery and decision errors',
        async (onError) => {
          vi.stubEnv('AGENT_HOOK_WEBHOOK_ON_ERROR', onError);
          const dispatcher = new HookDispatcher();
          for (const [status, body] of [
            [503, 'not JSON'],
            [200, { decision: 'invalid' }],
          ] as const) {
            responseStatus = status;
            response = body;
            expect(await evaluate(dispatcher)).toMatchObject({
              status: onError === 'block' ? 'blocked' : 'allow',
            });
          }
        },
      );

      it('keeps evaluating later policies after a notification response', async () => {
        response = { decision: 'deny' };
        const dispatcher = new HookDispatcher();
        dispatcher.register(event.operationId, [
          {
            id: 'notification-response',
            type,
            webhook: {
              url: url.replace('/ingress', '/notification'),
              responseHandling: 'toolCall',
              onError: 'block',
            },
          },
        ]);
        expect(await evaluate(dispatcher)).toMatchObject({ status: 'blocked' });
        expect(requests.map((request) => request.path)).toEqual(['/notification', '/ingress']);
      });
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
    const id = 'server-env-webhook:beforeToolCall';
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
    expect(requests.map((request) => request.path)).toEqual(['/ingress/internal']);
    expect(dispatcher.getSerializedHooks(event.operationId)).toEqual([original[0]]);
  });

  describe.each([false, true])('configuration changes in queue=%s', (queue) => {
    it.each([false, true])(
      'removes unselected events and switches the endpoint (cold=%s)',
      async (cold) => {
        queueMode.mockReturnValue(queue);
        const original: AgentHook = {
          id: 'internal-callback',
          type: 'afterToolCall',
          webhook: { url: `${url}/internal` },
        };
        const legacy = [original, ...getServerHooks()].map((hook) =>
          serializedAgentHookSchema.parse(hook),
        );
        const registered = new HookDispatcher();
        registered.register(event.operationId, [original]);
        const dispatcher = cold ? new HookDispatcher() : registered;

        vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', `${url}/new`);
        vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', 'afterToolCall');
        vi.stubEnv('AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING', 'ignore');
        vi.stubEnv('AGENT_HOOK_WEBHOOK_ON_ERROR', 'continue');
        response = { decision: 'deny' };
        expect(await dispatcher.evaluateToolCall(event.operationId, event, legacy)).toEqual({
          status: 'allow',
        });
        expect(dispatcher.canDeliver(event.operationId, 'beforeToolCall')).toBe(false);
        await dispatcher.dispatch(
          event.operationId,
          'onToolCallError',
          { ...event, error: 'test' },
          legacy,
        );
        expect(requests).toHaveLength(0);
        await dispatcher.dispatch(
          event.operationId,
          'afterToolCall',
          { ...event, result: { content: 'ok', success: true }, mocked: false },
          legacy,
        );
        expect(requests.map((request) => request.path)).toEqual([
          '/ingress/internal',
          '/ingress/new',
        ]);
      },
    );

    it.each([false, true])(
      'disables environment hooks when URL is removed (cold=%s)',
      async (cold) => {
        queueMode.mockReturnValue(queue);
        const original: AgentHook = {
          id: 'internal-callback',
          type: 'afterToolCall',
          webhook: { url: `${url}/internal` },
        };
        const legacy = [original, ...getServerHooks()].map((hook) =>
          serializedAgentHookSchema.parse(hook),
        );
        const registered = new HookDispatcher();
        registered.register(event.operationId, [original]);
        const dispatcher = cold ? new HookDispatcher() : registered;
        vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', undefined);
        response = { decision: 'deny' };
        expect(await dispatcher.evaluateToolCall(event.operationId, event, legacy)).toEqual({
          status: 'allow',
        });
        expect(dispatcher.canDeliver(event.operationId, 'beforeToolCall')).toBe(false);
        await dispatcher.dispatch(
          event.operationId,
          'afterToolCall',
          { ...event, result: { content: 'ok', success: true }, mocked: false },
          legacy,
        );
        expect(requests.map((request) => request.path)).toEqual(['/ingress/internal']);
      },
    );
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
    response = { decision: 'deny' };
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
    response = { decision: 'deny', reason: 'Denied after restore' };
    expect(await cold.evaluateToolCall(event.operationId, event, restored)).toEqual({
      reason: 'Denied after restore',
      status: 'blocked',
    });
    await cold.dispatch(
      event.operationId,
      'afterToolCall',
      { ...event, executionTimeMs: 1, result: { content: 'ok', success: true } },
      restored,
    );
    expect(requests.map((request) => request.path)).toEqual(['/ingress', '/ingress/internal']);
  });

  it.each(['continue', 'block'] as const)(
    'applies onError=%s to an invalid control response without leaking credentials',
    async (onError) => {
      vi.stubEnv('AGENT_HOOK_WEBHOOK_ON_ERROR', onError);
      response = { decision: 'synthetic-secret-two' };
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

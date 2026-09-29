import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { ToolRunResult } from '@lobechat/agent-runtime';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { HookDispatcher, hookDispatcher } from '../HookDispatcher';
import type {
  AfterToolCallHookEvent,
  AgentHook,
  AgentHookEvent,
  AgentHookType,
  SerializedHook,
} from '../types';
import { createWebhookPayloadBuilder } from '../webhookPayload';

const { getEmailsByIds, publishJSON, queueMode } = vi.hoisted(() => ({
  queueMode: { enabled: true },
  getEmailsByIds: vi.fn(),
  publishJSON: vi.fn(),
}));
vi.mock('@/database/models/user', () => ({ UserModel: { getEmailsByIds } }));
vi.mock('@/database/server', () => ({
  getServerDB: async () => ({}),
}));
vi.mock('@/server/services/queue/impls', () => ({
  isQueueAgentRuntimeEnabled: () => queueMode.enabled,
}));
vi.mock('@upstash/qstash', () => ({
  Client: class {
    publishJSON = publishJSON;
  },
}));

const hookTypes: AgentHookType[] = [
  'beforeStep',
  'afterStep',
  'onComplete',
  'onError',
  'beforeToolCall',
  'afterToolCall',
  'onToolCallError',
  'beforeCompact',
  'afterCompact',
  'onCompactError',
  'beforeCallAgent',
  'afterCallAgent',
  'onCallAgentError',
  'beforeHumanIntervention',
  'afterHumanIntervention',
  'onStopByHumanIntervention',
];
const event: AgentHookEvent = { agentId: 'agent', operationId: 'run', userId: 'visitor' };
const received: Record<string, unknown>[] = [];
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  received.push(JSON.parse(Buffer.concat(chunks).toString()));
  res.writeHead(200).end('{}');
});
let url: string;
let dispatcher: HookDispatcher;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
beforeEach(() => {
  queueMode.enabled = true;
  dispatcher = new HookDispatcher();
  received.length = 0;
  getEmailsByIds
    .mockReset()
    .mockImplementation(async (_db, ids: string[]) =>
      ids.map((id) => ({ id, email: `${id}@example.test` })),
    );
  publishJSON.mockReset().mockResolvedValue({});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const send = (type: AgentHookType = 'afterToolCall', webhook = { url }, payload = event) =>
  dispatcher.dispatch('run', type, payload, [{ id: 'notification', type, webhook }]);

describe('webhook user email', () => {
  it.each(hookTypes)('delivers the final user email for %s', async (type) => {
    await send(type);
    expect(received[0]).toMatchObject({
      userId: 'visitor',
      userEmail: 'visitor@example.test',
      hookType: type,
    });
    expect(event).not.toHaveProperty('userEmail');
  });

  it('uses the final body identity for its corresponding email', async () => {
    await dispatcher.dispatch('run', 'onComplete', event, [
      { id: 'external', type: 'onComplete', webhook: { url } },
      {
        id: 'internal',
        type: 'onComplete',
        webhook: { url, body: { userId: 'owner', userEmail: 'spoof@example.test' } },
      },
    ]);
    expect(received.map(({ userId, userEmail }) => ({ userId, userEmail }))).toEqual([
      { userId: 'visitor', userEmail: 'visitor@example.test' },
      { userId: 'owner', userEmail: 'owner@example.test' },
    ]);
    expect(event.userId).toBe('visitor');
    expect(getEmailsByIds).toHaveBeenCalledTimes(2);
    expect(getEmailsByIds).toHaveBeenCalledWith(expect.anything(), ['owner']);
  });

  it.each([{ rows: [] }, { rows: [{ id: 'visitor', email: null }] }])(
    'omits an unavailable email without an owner fallback',
    async ({ rows }) => {
      getEmailsByIds.mockResolvedValue(rows);
      await send();
      expect(received[0]).toHaveProperty('userId', 'visitor');
      expect(received[0]).not.toHaveProperty('userEmail');
    },
  );

  it('continues delivery when the lookup fails', async () => {
    getEmailsByIds.mockRejectedValue(new Error('database unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await send();
    expect(received[0]).toHaveProperty('userId', 'visitor');
    expect(received[0]).not.toHaveProperty('userEmail');
  });

  it('does not look up email when eventFields excludes it', async () => {
    await dispatcher.dispatch('run', 'onComplete', event, [
      {
        id: 'projected',
        type: 'onComplete',
        webhook: { url, eventFields: ['userId'] },
      },
    ]);
    expect(received[0]).not.toHaveProperty('userEmail');
    expect(getEmailsByIds).not.toHaveBeenCalled();
  });

  it('allows selecting email without including the id', async () => {
    await dispatcher.dispatch('run', 'onComplete', event, [
      {
        id: 'projected',
        type: 'onComplete',
        webhook: { url, eventFields: ['userEmail'] },
      },
    ]);
    expect(received[0]).toHaveProperty('userEmail', 'visitor@example.test');
    expect(received[0]).not.toHaveProperty('userId');
  });

  it('shares a lookup across concurrent events and refreshes after expiry', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    await Promise.all([send(), send('onComplete')]);
    expect(getEmailsByIds).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1000 + 5 * 60 * 1000);
    getEmailsByIds.mockResolvedValue([{ id: 'visitor', email: 'updated@example.test' }]);
    await send();
    expect(getEmailsByIds).toHaveBeenCalledTimes(2);
    expect(received[2]).toHaveProperty('userEmail', 'updated@example.test');
  });

  it.each([undefined, null, '', 42])(
    'does not substitute the event identity for an invalid final body id %s',
    async (userId) => {
      await dispatcher.dispatch('run', 'onComplete', event, [
        {
          id: 'invalid-id',
          type: 'onComplete',
          webhook: { url, body: { userId, userEmail: 'spoof@example.test' } },
        },
      ]);
      expect(received[0]).not.toHaveProperty('userEmail');
      expect(getEmailsByIds).not.toHaveBeenCalled();
    },
  );

  it('drops supplied email when no authoritative email is available', async () => {
    getEmailsByIds.mockResolvedValue([]);
    await dispatcher.dispatch(
      'run',
      'onComplete',
      Object.assign({}, event, { userEmail: 'event@example.test' }),
      [
        {
          id: 'spoof',
          type: 'onComplete',
          webhook: { url, body: { userEmail: 'body@example.test' } },
        },
      ],
    );
    expect(received[0]).not.toHaveProperty('userEmail');
  });

  it('resolves identity again in a restored worker', async () => {
    await send();
    dispatcher = new HookDispatcher();
    getEmailsByIds.mockResolvedValue([{ id: 'visitor', email: 'new@example.test' }]);
    await send();
    expect(received[1]).toHaveProperty('userEmail', 'new@example.test');
    expect(getEmailsByIds).toHaveBeenCalledTimes(2);
  });

  it('bounds cached identities instead of retaining every user for the process lifetime', async () => {
    const build = createWebhookPayloadBuilder();
    const metadata = { hookId: 'hook', hookType: 'onComplete' as const };
    await build(event, {}, metadata);
    for (let index = 0; index < 1000; index++) {
      await build({ ...event, userId: `user-${index}` }, {}, metadata);
    }
    await build(event, {}, metadata);
    expect(getEmailsByIds).toHaveBeenCalledTimes(1002);
  });

  it('reuses the final body identity email when already cached', async () => {
    await send('onComplete', { url }, { ...event, userId: 'owner' });
    await dispatcher.dispatch('run', 'onComplete', event, [
      {
        id: 'untrusted',
        type: 'onComplete',
        webhook: { url, body: { userId: 'owner' } },
      },
    ]);
    expect(received[0]).toHaveProperty('userEmail', 'owner@example.test');
    expect(received[1]).toHaveProperty('userEmail', 'owner@example.test');
    expect(getEmailsByIds).toHaveBeenCalledTimes(1);
  });

  it('cancels a waiter without cancelling another shared lookup', async () => {
    let complete!: (rows: { id: string; email: string }[]) => void;
    getEmailsByIds.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const build = createWebhookPayloadBuilder();
    const controller = new AbortController();
    const metadata = { hookId: 'control', hookType: 'beforeToolCall' as const };
    const cancelled = build(event, {}, metadata, { signal: controller.signal });
    const sibling = build(event, {}, metadata);
    controller.abort();
    expect(await cancelled).toBeUndefined();
    complete([{ id: 'visitor', email: 'visitor@example.test' }]);
    expect(await sibling).toHaveProperty('userEmail', 'visitor@example.test');
    expect(getEmailsByIds).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(0);
  });

  it('does not start a lookup for an already aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await createWebhookPayloadBuilder()(
        event,
        {},
        { hookId: 'control', hookType: 'beforeToolCall' },
        { signal: controller.signal },
      ),
    ).toBeUndefined();
    expect(getEmailsByIds).not.toHaveBeenCalled();
  });

  it('preserves control-specific input without requiring a notification event shape', async () => {
    const args = { query: 'effective' };
    const originalArgs = { query: 'original' };
    const payload = await createWebhookPayloadBuilder()(
      { userId: 'visitor', args, originalArgs },
      {},
      { hookId: 'control', hookType: 'beforeToolCall' },
    );
    expect(payload).toMatchObject({ args, originalArgs, userEmail: 'visitor@example.test' });
  });

  it.each(['consecutive', 'concurrent'] as const)(
    'keeps each final user email distinct on the global dispatcher across %s deliveries',
    async (mode) => {
      const deliver = (suffix: string) => {
        const visitor = `${mode}-visitor-${suffix}`;
        const owner = `${mode}-owner-${suffix}`;
        return hookDispatcher.dispatch(
          `run-${suffix}`,
          'onComplete',
          {
            ...event,
            operationId: `run-${suffix}`,
            userId: visitor,
          },
          [
            { id: 'external', type: 'onComplete', webhook: { url } },
            { id: 'internal', type: 'onComplete', webhook: { url, body: { userId: owner } } },
          ],
        );
      };
      if (mode === 'concurrent') {
        let started!: () => void;
        let release!: () => void;
        const firstLookup = new Promise<void>((resolve) => {
          started = resolve;
        });
        const resume = new Promise<void>((resolve) => {
          release = resolve;
        });
        getEmailsByIds.mockImplementation(async (_db, ids: string[]) => {
          if (ids[0] === `${mode}-visitor-a`) {
            started();
            await resume;
          }
          return ids.map((id) => ({ id, email: `${id}@example.test` }));
        });
        const first = deliver('a');
        await firstLookup;
        try {
          await deliver('b');
        } finally {
          release();
        }
        await first;
      } else {
        await deliver('a');
        await deliver('b');
      }
      expect(received.map(({ userId, userEmail }) => ({ userId, userEmail }))).toEqual(
        expect.arrayContaining(
          ['visitor-a', 'owner-a', 'visitor-b', 'owner-b'].map((id) => ({
            userId: `${mode}-${id}`,
            userEmail: `${mode}-${id}@example.test`,
          })),
        ),
      );
      expect(received).toHaveLength(4);
      expect(getEmailsByIds).toHaveBeenCalledTimes(4);
    },
  );

  it('resolves the final body identity on a cold queue worker', async () => {
    vi.stubEnv('QSTASH_TOKEN', 'test-token');
    const hooks: SerializedHook[] = [
      {
        id: 'internal',
        type: 'onComplete',
        webhook: { url, delivery: 'qstash', fallback: 'none', body: { userId: 'owner' } },
      },
    ];
    const serializedHooks = JSON.stringify(hooks);
    const restoredHooks: SerializedHook[] = JSON.parse(serializedHooks);
    await dispatcher.dispatch('run', 'onComplete', event, hooks);
    dispatcher = new HookDispatcher();
    await dispatcher.dispatch('run', 'onComplete', event, restoredHooks);
    await dispatcher.dispatch('run', 'onComplete', event, restoredHooks);
    await dispatcher.dispatch('run', 'onComplete', event, restoredHooks);
    const bodies = publishJSON.mock.calls.map(([request]) => request.body);
    expect(bodies.map(({ userEmail }) => userEmail)).toEqual([
      'owner@example.test',
      'owner@example.test',
      'owner@example.test',
      'owner@example.test',
    ]);
    expect(bodies.every((payload) => !('ownerUserId' in payload))).toBe(true);
    expect(JSON.stringify(hooks)).toBe(serializedHooks);
    expect(getEmailsByIds).toHaveBeenCalledTimes(2);
  });

  it.each([{ rows: [] }, { rows: [{ id: 'owner', email: null }] }])(
    'omits unavailable owner email without substituting visitor email',
    async ({ rows }) => {
      getEmailsByIds.mockImplementation(async (_db, ids: string[]) =>
        ids[0] === 'visitor' ? [{ id: 'visitor', email: 'visitor@example.test' }] : rows,
      );
      await send();
      await dispatcher.dispatch('run', 'onComplete', event, [
        { id: 'internal', type: 'onComplete', webhook: { url, body: { userId: 'owner' } } },
      ]);
      expect(received[1]).toHaveProperty('userId', 'owner');
      expect(received[1]).not.toHaveProperty('userEmail');
    },
  );

  it('omits owner email on lookup failure and continues delivery', async () => {
    getEmailsByIds.mockRejectedValue(new Error('lookup unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await dispatcher.dispatch('run', 'onComplete', event, [
      { id: 'internal', type: 'onComplete', webhook: { url, body: { userId: 'owner' } } },
    ]);
    expect(received[0]).not.toHaveProperty('userEmail');
  });

  it('includes the resolved email in QStash JSON', async () => {
    vi.stubEnv('QSTASH_TOKEN', 'test-token');
    const queued: SerializedHook = {
      id: 'queued',
      type: 'onComplete',
      webhook: { url, delivery: 'qstash', fallback: 'none' },
    };
    await dispatcher.dispatch('run', 'onComplete', event, [queued]);
    expect(publishJSON).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ userId: 'visitor', userEmail: 'visitor@example.test' }),
      }),
    );
  });
});

describe('webhook tool results', () => {
  it.each([
    { delivery: 'fetch', projected: false },
    { delivery: 'fetch', projected: true },
    { delivery: 'qstash', projected: false },
    { delivery: 'qstash', projected: true },
  ] as const)(
    'trims Work payloads for $delivery (projected: $projected)',
    async ({ delivery, projected }) => {
      vi.stubEnv('QSTASH_TOKEN', 'test-token');
      const args = Object.freeze({ repository: 'example/project', number: 42 });
      const data = Object.freeze({ body: 'raw tool output'.repeat(1000), number: 42 });
      const intent = Object.freeze({
        args,
        data,
        provider: 'github',
        toolName: 'getIssue',
        type: 'skill' as const,
      });
      const result: ToolRunResult = Object.freeze({
        content: 'Issue summary',
        executionTime: 100,
        state: { archived: true },
        success: true,
        workRegistration: intent,
      });
      const after: AfterToolCallHookEvent = {
        ...event,
        apiName: 'getIssue',
        args,
        assistantMessageId: 'assistant-1',
        callIndex: 0,
        executor: 'server',
        identifier: 'github',
        mocked: false,
        result,
        stepIndex: 1,
        toolCallId: 'call-1',
      };
      await dispatcher.dispatch('run', 'afterToolCall', after, [
        {
          id: 'tool-result',
          type: 'afterToolCall',
          webhook: { url, delivery, eventFields: projected ? ['result'] : undefined },
        },
      ]);
      const payload = delivery === 'fetch' ? received[0] : publishJSON.mock.calls[0][0].body;
      expect(payload.result).toEqual({
        content: result.content,
        executionTime: 100,
        state: result.state,
        success: true,
        workRegistration: {
          args: undefined,
          data: null,
          provider: 'github',
          toolName: 'getIssue',
          type: 'skill',
        },
      });
      expect(after.result).toBe(result);
      expect(result.workRegistration).toBe(intent);
      expect(intent.args).toBe(args);
      expect(intent.data).toBe(data);
    },
  );

  it('preserves task Work metadata in the webhook result', async () => {
    const result: ToolRunResult = {
      content: 'Task created',
      success: true,
      workRegistration: { action: 'create', targets: [{ taskId: 'task-1' }], type: 'task' },
    };
    const payload = await createWebhookPayloadBuilder()(
      { ...event, result },
      { eventFields: ['result'] },
      { hookId: 'task-result', hookType: 'afterToolCall' },
    );
    expect(payload?.result).toEqual(result);
  });
});

describe('before-tool observation identity', () => {
  it.each([false, true])(
    'delivers final payload identity while preserving mock short-circuiting (queue=%s)',
    async (isQueue) => {
      queueMode.enabled = isQueue;
      const first = vi.fn((event) => event.mock({ content: 'mocked', success: true }));
      const skipped = vi.fn();
      const hooks: AgentHook[] = [
        { id: 'first-mock', type: 'beforeToolCall', handler: first },
        { id: 'later-handler', type: 'beforeToolCall', handler: skipped },
        ...['owner-notification', 'sibling'].map((id): AgentHook => ({
          id,
          type: 'beforeToolCall',
          webhook: { url, body: { userId: 'owner' } },
        })),
      ];
      dispatcher.register('run', hooks);
      const serialized = dispatcher.getSerializedHooks('run');
      if (isQueue) dispatcher = new HookDispatcher(); // Cold worker has only persisted hooks.
      const toolEvent = {
        ...event,
        apiName: 'write',
        args: {},
        assistantMessageId: 'assistant',
        callIndex: 0,
        stepIndex: 0,
        executor: 'server' as const,
        identifier: 'fs',
        toolCallId: 'native',
      };
      const result = await dispatcher.dispatchBeforeToolCall('run', toolEvent, serialized);
      expect(result).toEqual(
        isQueue ? null : { isMocked: true, result: { content: 'mocked', success: true } },
      );
      expect(first).toHaveBeenCalledTimes(isQueue ? 0 : 1);
      expect(skipped).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(received).toHaveLength(2));
      for (const payload of received) {
        expect(payload).toMatchObject({ userId: 'owner', userEmail: 'owner@example.test' });
        expect(payload).not.toHaveProperty('mock');
        expect(payload).not.toHaveProperty('deliveryContext');
        expect(payload).not.toHaveProperty('ownerUserId');
      }
      // A later delivery reuses the final identity email without invoking skipped handlers.
      await dispatcher.dispatchBeforeToolCall('run', toolEvent, serialized);
      await vi.waitFor(() => expect(received).toHaveLength(4));
      expect(received[2]).toMatchObject({ userId: 'owner', userEmail: 'owner@example.test' });
      expect(received[3]).toMatchObject({ userId: 'owner', userEmail: 'owner@example.test' });
      expect(getEmailsByIds).toHaveBeenCalledTimes(1);
      expect(skipped).not.toHaveBeenCalled();
      expect(JSON.stringify(serialized)).not.toContain('ownerUserId');
    },
  );
});

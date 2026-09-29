import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HookDispatcher } from '../HookDispatcher';
import type { AgentHook } from '../types';

const { fetchHook, getEmailsByIds } = vi.hoisted(() => ({
  fetchHook: vi.fn(),
  getEmailsByIds: vi.fn(),
}));
vi.mock('@/database/models/user', () => ({ UserModel: { getEmailsByIds } }));
vi.mock('@/database/server', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: () => false }));
vi.mock('@/libs/qstash', () => ({ OtelQstashClient: class {} }));

const event = {
  apiName: 'write',
  args: { path: 'effective' },
  assistantMessageId: 'assistant',
  callIndex: 0,
  executor: 'server' as const,
  identifier: 'fs',
  operationId: 'op',
  stepIndex: 0,
  toolCallId: 'native',
  userId: 'visitor',
  userEmail: 'untrusted@example.test',
};
function setup(onError: 'continue' | 'block' = 'continue') {
  const hook: AgentHook = {
    id: 'control',
    type: 'beforeToolCall',
    webhook: {
      url: 'https://hooks.example/control',
      responseHandling: 'toolCall',
      onError,
    },
  };
  const dispatcher = new HookDispatcher();
  dispatcher.register('op', [hook]);
  return dispatcher;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchHook);
  getEmailsByIds.mockReset().mockResolvedValue([{ id: 'visitor', email: 'visitor@example.test' }]);
  fetchHook.mockReset().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: 'beforeToolCall', permissionDecision: 'allow' },
        }),
      ),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('control webhook payload enrichment', () => {
  it('enriches authoritative controls without applying body overrides or projections', async () => {
    expect(await setup().evaluateToolCall('op', event)).toEqual({
      status: 'allow',
    });
    expect(getEmailsByIds).toHaveBeenCalledWith({}, ['visitor']);
    expect(JSON.parse(fetchHook.mock.calls[0][1].body)).toMatchObject({
      ...event,
      userEmail: 'visitor@example.test',
      hookId: 'control',
      hookType: 'beforeToolCall',
    });
  });

  it.each(['continue', 'block'] as const)(
    'omits failed email enrichment without invoking control onError=%s',
    async (policy) => {
      getEmailsByIds.mockRejectedValue(new Error('database unavailable'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await setup(policy).evaluateToolCall('op', event)).toMatchObject({ status: 'allow' });
      expect(getEmailsByIds).toHaveBeenCalledTimes(1);
      expect(JSON.parse(fetchHook.mock.calls[0][1].body)).not.toHaveProperty('userEmail');
      expect(fetchHook).toHaveBeenCalledTimes(1);
    },
  );

  it('does not look up email or send HTTP after prior cancellation', async () => {
    const abort = new AbortController();
    abort.abort();
    expect(await setup().evaluateToolCall('op', event, undefined, abort.signal)).toMatchObject({
      status: 'cancelled',
    });
    expect(getEmailsByIds).not.toHaveBeenCalled();
    expect(fetchHook).not.toHaveBeenCalled();
  });

  it('cancels an email waiter without sending HTTP or cancelling its sibling', async () => {
    let resolveEmail!: (rows: { id: string; email: string }[]) => void;
    getEmailsByIds.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEmail = resolve;
        }),
    );
    const dispatcher = setup();
    const abort = new AbortController();
    const cancelled = dispatcher.evaluateToolCall('op', event, undefined, abort.signal);
    const sibling = dispatcher.evaluateToolCall('op', { ...event, toolCallId: 'sibling' });
    await vi.waitFor(() => expect(getEmailsByIds).toHaveBeenCalledTimes(1));
    abort.abort();
    expect(await cancelled).toMatchObject({ status: 'cancelled' });
    expect(fetchHook).not.toHaveBeenCalled();
    resolveEmail([{ id: 'visitor', email: 'visitor@example.test' }]);
    expect(await sibling).toMatchObject({ status: 'allow' });
    expect(fetchHook).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchHook.mock.calls[0][1].body)).toMatchObject({
      toolCallId: 'sibling',
      userEmail: 'visitor@example.test',
    });
  });
});

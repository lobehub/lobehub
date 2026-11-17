import type { InboundWebhookItem } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { McpEventsExecutionService, McpEventsManageService } from './index';
import { McpEventsExecutionRuntime } from './index';

const AGENT = 'agent-current';
const USER = 'user-current';
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

const subscription = (overrides: Partial<InboundWebhookItem> = {}): InboundWebhookItem => ({
  agent: { avatar: null, backgroundColor: null, id: AGENT, title: 'Agent' },
  canCheck: true,
  canConfigure: true,
  canManage: true,
  channel: null,
  connector: { agentId: null, avatar: null, id: 'c1', identifier: 'linear', name: 'Linear' },
  createdAt: '2026-11-17T00:00:00.000Z',
  creatorId: USER,
  endpoint: null,
  expiresAt: null,
  id: ID,
  identifier: 'issue.created',
  instructions: 'Triage new bugs',
  kind: 'mcp_events',
  lastDeliveryAt: null,
  lastError: null,
  name: 'Web bugs',
  source: { arguments: { team: 'WEB' }, eventName: 'issue.created', kind: 'mcp_events' },
  status: 'active',
  topic: { id: 'topic-other', title: 'Bug triage' },
  ...overrides,
});

const webhook = subscription({
  canCheck: false,
  connector: null,
  endpoint: 'https://app.example.com/api/webhooks/inbound/x',
  identifier: 'alerts',
  kind: 'generic',
  name: 'Alerts',
  source: { autoApprove: false, kind: 'generic', topicMode: 'new' },
  topic: null,
});

const createRuntime = () => {
  const events = {
    listEventTypes: vi.fn().mockResolvedValue({ eventTypes: [] }),
    listSubscriptions: vi.fn().mockResolvedValue({ subscriptions: [] }),
    subscribeEvent: vi.fn(),
  } satisfies McpEventsExecutionService;
  const manager = {
    check: vi.fn(async () => subscription({ lastError: null, status: 'active' })),
    delete: vi.fn(async () => ({ success: true })),
    get: vi.fn(async () => subscription()),
    list: vi.fn(async () => [subscription()]),
    update: vi.fn(async (_id: string, input: { name?: string | null }) =>
      subscription({ name: input.name || 'issue.created' }),
    ),
  } satisfies McpEventsManageService;
  const runtime = new McpEventsExecutionRuntime(
    { events, manager },
    { agentId: AGENT, topicId: 'topic-current', userId: USER },
  );
  return { events, manager, runtime };
};

describe('MCP Events execution: this topic', () => {
  it('binds discovery, subscribing and topic listing to the executing agent and topic', async () => {
    const { events, runtime } = createRuntime();
    const injected = { agentId: 'agent-other', topicId: 'topic-other' };

    await runtime.subscribeEvent({
      ...injected,
      connector: 'linear',
      instructions: 'Notify me',
      name: 'issue.created',
    } as never);
    expect(events.subscribeEvent).toHaveBeenCalledWith({
      agentId: AGENT,
      arguments: undefined,
      connector: 'linear',
      instructions: 'Notify me',
      name: 'issue.created',
      topicId: 'topic-current',
    });

    await runtime.listSubscriptions(injected as never);
    expect(events.listSubscriptions).toHaveBeenCalledWith({
      agentId: AGENT,
      topicId: 'topic-current',
    });

    await runtime.listEventTypes({ connector: 'linear' });
    expect(events.listEventTypes).toHaveBeenCalledWith({
      agentId: AGENT,
      connector: 'linear',
      topicId: 'topic-current',
    });
  });

  it('never passes the user id to the topic service', async () => {
    const { events, runtime } = createRuntime();
    await runtime.listSubscriptions({ scope: 'topic' });
    expect(events.listSubscriptions.mock.calls[0][0]).not.toHaveProperty('userId');
  });
});

describe('MCP Events execution: the whole agent', () => {
  it("lists this agent's subscriptions the user made, in any topic, with name and event", async () => {
    const { events, manager, runtime } = createRuntime();
    manager.list.mockResolvedValue([
      subscription(),
      subscription({ creatorId: 'colleague', id: OTHER_ID }),
      subscription({ agent: { ...subscription().agent!, id: 'agent-other' }, id: OTHER_ID }),
      webhook,
    ]);
    const result = await runtime.listSubscriptions({ scope: 'agent' });
    expect(manager.list).toHaveBeenCalledWith({ agentId: AGENT, kind: 'mcp_events' });
    expect(events.listSubscriptions).not.toHaveBeenCalled();
    expect(result.state).toEqual({
      scope: 'agent',
      subscriptions: [
        {
          arguments: { team: 'WEB' },
          connector: { identifier: 'linear', name: 'Linear' },
          eventName: 'issue.created',
          expiresAt: null,
          id: ID,
          instructions: 'Triage new bugs',
          lastError: null,
          name: 'Web bugs',
          status: 'active',
          topic: { id: 'topic-other', title: 'Bug triage' },
        },
      ],
    });
  });

  it('renames only the display name; the event it follows stays', async () => {
    const { manager, runtime } = createRuntime();
    const result = await runtime.renameSubscription({ name: 'Mobile bugs', subscriptionId: ID });
    expect(manager.update).toHaveBeenCalledWith(ID, { name: 'Mobile bugs' });
    expect(result.state.subscription).toMatchObject({
      eventName: 'issue.created',
      name: 'Mobile bugs',
    });

    // Empty shows the event again; the manager owns that fallback.
    const reset = await runtime.renameSubscription({ name: '', subscriptionId: ID });
    expect(manager.update).toHaveBeenLastCalledWith(ID, { name: '' });
    expect(reset.state.subscription.name).toBe('issue.created');
  });

  it('checks a subscription in another topic of this agent', async () => {
    const { manager, runtime } = createRuntime();
    const result = await runtime.checkSubscription({ subscriptionId: ID });
    expect(manager.check).toHaveBeenCalledWith(ID);
    expect(result).toMatchObject({ state: { subscription: { id: ID } }, success: true });
  });

  it('removes a subscription in another topic of this agent through the manager', async () => {
    const { manager, runtime } = createRuntime();
    const result = await runtime.unsubscribeEvent({
      agentId: 'agent-other',
      subscriptionId: ID,
      topicId: 'topic-other',
    } as never);
    expect(manager.delete).toHaveBeenCalledWith(ID);
    expect(result.state).toEqual({
      eventName: 'issue.created',
      name: 'Web bugs',
      removed: true,
      subscriptionId: ID,
    });
  });

  it.each([
    ['another agent', subscription({ agent: { ...subscription().agent!, id: 'agent-other' } })],
    ['another member', subscription({ creatorId: 'colleague' })],
    ['an agent the user cannot see', subscription({ agent: null })],
    ['a custom webhook', webhook],
  ])('refuses a row of %s as not found in every action', async (_label, row) => {
    const { manager, runtime } = createRuntime();
    manager.get.mockResolvedValue(row);
    for (const call of [
      () => runtime.renameSubscription({ name: 'x', subscriptionId: ID }),
      () => runtime.checkSubscription({ subscriptionId: ID }),
      () => runtime.unsubscribeEvent({ subscriptionId: ID }),
    ]) {
      const result = await call();
      expect(result).toMatchObject({ state: { error: { code: 'not_found' } }, success: false });
    }
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.check).not.toHaveBeenCalled();
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('points a custom webhook id to the Webhooks tool', async () => {
    const { manager, runtime } = createRuntime();
    manager.get.mockResolvedValue(webhook);
    const result = await runtime.unsubscribeEvent({ subscriptionId: ID });
    expect(result.content).toContain('Webhooks tool');
  });

  it('reads a malformed id or a missing row as not found', async () => {
    const { manager, runtime } = createRuntime();
    expect((await runtime.unsubscribeEvent({ subscriptionId: 'webhook' })).state.error.code).toBe(
      'not_found',
    );
    expect(manager.get).not.toHaveBeenCalled();

    manager.get.mockRejectedValue(
      Object.assign(new Error('Webhook not found.'), { code: 'not_found' }),
    );
    expect((await runtime.checkSubscription({ subscriptionId: ID })).state.error).toEqual({
      code: 'not_found',
      message: 'No subscription of yours on this agent has this id.',
    });
  });

  it('passes the manager codes through, reading its disabled as feature_disabled', async () => {
    const { manager, runtime } = createRuntime();
    manager.check.mockRejectedValue(
      Object.assign(new Error('Wait 30 seconds before checking again.'), { code: 'rate_limited' }),
    );
    expect((await runtime.checkSubscription({ subscriptionId: ID })).state.error.code).toBe(
      'rate_limited',
    );
    manager.list.mockRejectedValue(
      Object.assign(new Error('Webhooks are not enabled.'), { code: 'disabled' }),
    );
    expect((await runtime.listSubscriptions({ scope: 'agent' })).state.error.code).toBe(
      'feature_disabled',
    );
  });
});

describe('MCP Events execution: results', () => {
  it('preserves structured successful output for the model and result card', async () => {
    const { events, runtime } = createRuntime();
    const state = {
      eventTypes: [
        {
          connector: { identifier: 'linear', name: 'Linear' },
          name: 'issue.created',
          subscribable: true,
        },
      ],
    };
    events.listEventTypes.mockResolvedValue(state);
    const result = await runtime.listEventTypes();
    expect(result).toEqual({ success: true, state, content: JSON.stringify(state) });
  });

  it.each([
    'feature_disabled',
    'forbidden',
    'invalid_arguments',
    'callback_unreachable',
    'channel_unsupported',
    'limit_reached',
  ])('returns a stable %s error code in state and the error envelope', async (code) => {
    const { events, runtime } = createRuntime();
    events.listEventTypes.mockRejectedValue(Object.assign(new Error('A readable error'), { code }));
    expect(await runtime.listEventTypes()).toEqual({
      success: false,
      content: 'A readable error',
      error: { type: code, message: 'A readable error' },
      state: { error: { code, message: 'A readable error' } },
    });
  });

  it('normalizes unknown provider error codes', async () => {
    const { events, runtime } = createRuntime();
    events.listEventTypes.mockRejectedValue(Object.assign(new Error('Unavailable'), { code: 503 }));
    expect(await runtime.listEventTypes()).toMatchObject({
      success: false,
      state: { error: { code: 'unknown', message: 'Unavailable' } },
    });
  });
});

import type { InboundWebhookItem } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import type { WebhookChannelOrigin, WebhookManageService } from './index';
import { WebhookExecutionRuntime } from './index';

const AGENT = 'agent-current';
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const SECRET = 'whk_super_secret_value';

const item = (overrides: Partial<InboundWebhookItem> = {}): InboundWebhookItem => ({
  agent: { avatar: null, backgroundColor: null, id: AGENT, title: 'Agent' },
  canCheck: false,
  canConfigure: true,
  canManage: true,
  channel: null,
  connector: null,
  createdAt: '2026-11-17T00:00:00.000Z',
  creatorId: 'user',
  endpoint: `https://app.example.com/api/webhooks/inbound/${ID}`,
  expiresAt: null,
  id: ID,
  identifier: 'alerts',
  instructions: 'Triage the alert',
  kind: 'generic',
  lastDeliveryAt: null,
  lastError: null,
  name: 'Alerts',
  source: { autoApprove: false, kind: 'generic', topicMode: 'new' },
  status: 'active',
  topic: null,
  ...overrides,
});

const subscription = item({
  canCheck: true,
  connector: {
    agentId: null,
    avatar: null,
    id: 'c1',
    identifier: 'linear',
    name: 'Linear',
  },
  endpoint: null,
  identifier: 'issue.created',
  kind: 'mcp_events',
  source: { arguments: { team: 'ENG' }, eventName: 'issue.created', kind: 'mcp_events' },
});

const setup = (origin?: WebhookChannelOrigin) => {
  const service = {
    create: vi.fn(async () => ({ item: item(), secret: SECRET })),
    delete: vi.fn(async () => ({ success: true })),
    get: vi.fn(async (id: string) => {
      if (id === OTHER_ID) return item({ agent: { ...item().agent!, id: 'agent-other' } });
      return item();
    }),
    list: vi.fn(async () => [item(), subscription]),
    listDeliveries: vi.fn(async () => ({ items: [] })),
    sendTest: vi.fn(async () => ({ accepted: true, status: 202 })),
    update: vi.fn(async () => item()),
  } satisfies WebhookManageService;
  const channelOrigin = vi.fn(async () => origin);
  const runtime = new WebhookExecutionRuntime(service, { agentId: AGENT, channelOrigin });
  return { channelOrigin, runtime, service };
};

describe('webhook tool: keys', () => {
  it('creates a webhook without the key reaching the model or the result card', async () => {
    const { runtime, service } = setup();
    const result = await runtime.createWebhook({ instructions: 'Triage', name: 'Alerts' });

    expect(service.create).toHaveBeenCalledWith({
      agentId: AGENT,
      instructions: 'Triage',
      name: 'Alerts',
    });
    expect(result.success).toBe(true);
    expect(result.content).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result.state.webhook).toMatchObject({ endpoint: item().endpoint, id: ID });
    expect(result.state.webhook).not.toHaveProperty('secret');
  });
});

describe('webhook tool: agent scope', () => {
  it('lists only custom webhooks of the current agent, ignoring a model-supplied agent', async () => {
    const { runtime, service } = setup();
    service.list.mockResolvedValue([
      item(),
      item({ agent: { ...item().agent!, id: 'agent-other' }, id: OTHER_ID }),
      // The manager is asked for custom webhooks only; a subscription that slips through is dropped.
      subscription,
    ]);
    const result = await runtime.listWebhooks({
      agentId: 'agent-other',
      kind: 'mcp_events',
    } as never);
    expect(service.list).toHaveBeenCalledWith({ agentId: AGENT, kind: 'generic' });
    expect(result.state.webhooks).toEqual([
      expect.objectContaining({ id: ID, identifier: 'alerts', name: 'Alerts', topicMode: 'new' }),
    ]);
    expect(result.content).toContain('"identifier":"alerts"');
    expect(result.state.webhooks[0]).not.toHaveProperty('kind');
    expect(result.state.webhooks[0]).not.toHaveProperty('event');
  });

  it('keeps the fixed identifier when only the name changes', async () => {
    const { runtime, service } = setup();
    service.update.mockResolvedValue(item({ name: 'Pager alerts' }));
    const result = await runtime.updateWebhook({ name: 'Pager alerts', webhookId: ID });
    expect(service.update).toHaveBeenCalledWith(ID, { name: 'Pager alerts' });
    expect(result.state.webhook).toMatchObject({ identifier: 'alerts', name: 'Pager alerts' });
  });

  it.each([
    ['updateWebhook', { name: 'x' }],
    ['sendTestWebhook', {}],
    ['listWebhookCalls', {}],
    ['deleteWebhook', {}],
  ] as const)('treats a webhook of another agent as not found in %s', async (api, extra) => {
    const { runtime, service } = setup();
    const result = await (runtime[api] as (args: object) => Promise<any>)({
      webhookId: OTHER_ID,
      ...extra,
    });
    expect(result).toMatchObject({ state: { error: { code: 'not_found' } }, success: false });
    expect(service.update).not.toHaveBeenCalled();
    expect(service.sendTest).not.toHaveBeenCalled();
    expect(service.listDeliveries).not.toHaveBeenCalled();
    expect(service.delete).not.toHaveBeenCalled();
  });

  it('reads a malformed id as not found without asking the server', async () => {
    const { runtime, service } = setup();
    const result = await runtime.deleteWebhook({ webhookId: 'not-a-uuid' });
    expect(result.state.error.code).toBe('not_found');
    expect(service.get).not.toHaveBeenCalled();
  });

  it.each([
    ['updateWebhook', { name: 'Web bugs' }],
    ['sendTestWebhook', {}],
    ['listWebhookCalls', {}],
    ['deleteWebhook', {}],
  ] as const)(
    'never touches an MCP Events subscription of this agent in %s, pointing to its tool',
    async (api, extra) => {
      const { runtime, service } = setup();
      service.get.mockResolvedValue(subscription);
      const result = await (runtime[api] as (args: object) => Promise<any>)({
        webhookId: ID,
        ...extra,
      });
      expect(result).toMatchObject({ state: { error: { code: 'not_found' } }, success: false });
      expect(result.content).toContain('MCP Events tool');
      expect(service.update).not.toHaveBeenCalled();
      expect(service.sendTest).not.toHaveBeenCalled();
      expect(service.listDeliveries).not.toHaveBeenCalled();
      expect(service.delete).not.toHaveBeenCalled();
    },
  );

  it('deletes a custom webhook, naming it by name and identifier', async () => {
    const { runtime, service } = setup();
    expect(await runtime.deleteWebhook({ webhookId: ID })).toMatchObject({
      state: { deleted: true, identifier: 'alerts', name: 'Alerts', webhookId: ID },
      success: true,
    });
    expect(service.delete).toHaveBeenCalledWith(ID);
  });
});

describe('webhook tool: Channel delivery', () => {
  const thread = { channelId: 'ch_1', threadId: 'cht_1' };
  const timeline = { channelId: 'ch_1', threadId: null };

  it('defaults a webhook made in a Thread to that Thread, with auto-approve', async () => {
    const { runtime, service } = setup(thread);
    await runtime.createWebhook({ instructions: 'Triage' });
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        autoApprove: true,
        delivery: { channelId: 'ch_1', threadId: 'cht_1' },
      }),
    );
  });

  it('defaults a webhook made on the main timeline to the Channel', async () => {
    const { runtime, service } = setup(timeline);
    await runtime.createWebhook({});
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ autoApprove: true, delivery: { channelId: 'ch_1' } }),
    );
  });

  it("posts to the main timeline for 'channel' from a Thread, and nowhere for 'topic'", async () => {
    const { runtime, service } = setup(thread);
    await runtime.createWebhook({ deliverTo: 'channel' });
    expect(service.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ delivery: { channelId: 'ch_1' } }),
    );
    await runtime.createWebhook({ deliverTo: 'topic' });
    expect(service.create).toHaveBeenLastCalledWith({ agentId: AGENT });
  });

  it("refuses 'thread' on the main timeline", async () => {
    const { runtime, service } = setup(timeline);
    const result = await runtime.createWebhook({ deliverTo: 'thread' });
    expect(result.state.error.code).toBe('not_in_channel');
    expect(service.create).not.toHaveBeenCalled();
  });

  it('offers only topics outside a Channel run', async () => {
    const { runtime, service } = setup(undefined);
    await runtime.createWebhook({ autoApprove: false });
    expect(service.create).toHaveBeenLastCalledWith({ agentId: AGENT, autoApprove: false });
    for (const deliverTo of ['channel', 'thread'] as const) {
      const result = await runtime.createWebhook({ deliverTo });
      expect(result).toMatchObject({
        error: { type: 'not_in_channel' },
        state: { error: { code: 'not_in_channel' } },
        success: false,
      });
    }
    expect(service.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a Channel destination with auto-approve explicitly off', async () => {
    const { runtime, service } = setup(thread);
    const result = await runtime.createWebhook({ autoApprove: false });
    expect(result.state.error.code).toBe('bad_request');
    expect(service.create).not.toHaveBeenCalled();
  });

  it('on update keeps the destination unless deliverTo is given, and topic stops posting', async () => {
    const { channelOrigin, runtime, service } = setup(thread);
    await runtime.updateWebhook({ name: 'Renamed', webhookId: ID });
    expect(service.update).toHaveBeenLastCalledWith(ID, { name: 'Renamed' });
    expect(channelOrigin).not.toHaveBeenCalled();

    await runtime.updateWebhook({ deliverTo: 'thread', webhookId: ID });
    expect(service.update).toHaveBeenLastCalledWith(ID, {
      autoApprove: true,
      delivery: { channelId: 'ch_1', threadId: 'cht_1' },
    });

    await runtime.updateWebhook({ autoApprove: false, deliverTo: 'topic', webhookId: ID });
    expect(service.update).toHaveBeenLastCalledWith(ID, { autoApprove: false, delivery: null });
  });

  it('refuses turning auto-approve off while the webhook still posts to a Channel', async () => {
    const { runtime, service } = setup(undefined);
    service.get.mockResolvedValue(
      item({ source: { autoApprove: true, delivery: thread, kind: 'generic', topicMode: 'new' } }),
    );
    const result = await runtime.updateWebhook({ autoApprove: false, webhookId: ID });
    expect(result.state.error.code).toBe('bad_request');
    expect(service.update).not.toHaveBeenCalled();
  });

  it('refuses an update with nothing to change', async () => {
    const { runtime, service } = setup();
    expect((await runtime.updateWebhook({ webhookId: ID })).state.error.code).toBe('bad_request');
    expect(service.update).not.toHaveBeenCalled();
  });
});

describe('webhook tool: results and errors', () => {
  it('pauses, tests and pages calls with the server result', async () => {
    const { runtime, service } = setup();
    await runtime.updateWebhook({ paused: true, webhookId: ID });
    expect(service.update).toHaveBeenLastCalledWith(ID, { paused: true });

    service.sendTest.mockResolvedValue({ accepted: false, error: 'paused', status: 409 });
    expect((await runtime.sendTestWebhook({ webhookId: ID })).state).toEqual({
      accepted: false,
      error: 'paused',
      status: 409,
      webhookId: ID,
    });

    const cursor = { createdAt: '2026-11-17T00:00:00.000Z', id: OTHER_ID };
    service.listDeliveries.mockResolvedValue({ items: [], nextCursor: cursor } as never);
    const calls = await runtime.listWebhookCalls({ cursor, webhookId: ID });
    expect(service.listDeliveries).toHaveBeenCalledWith(ID, cursor);
    expect(calls.state).toEqual({ calls: [], nextCursor: cursor, webhookId: ID });
  });

  it.each(['bad_request', 'disabled', 'forbidden', 'not_found', 'rate_limited'])(
    'passes the manager code %s through to state and the error envelope',
    async (code) => {
      const { runtime, service } = setup();
      service.list.mockRejectedValue(Object.assign(new Error('A readable error'), { code }));
      expect(await runtime.listWebhooks()).toEqual({
        content: 'A readable error',
        error: { message: 'A readable error', type: code },
        state: { error: { code, message: 'A readable error' } },
        success: false,
      });
    },
  );

  it('normalizes foreign error codes to unknown', async () => {
    const { runtime, service } = setup();
    service.list.mockRejectedValue(Object.assign(new Error('boom'), { code: 'ECONNRESET' }));
    expect((await runtime.listWebhooks()).state.error).toEqual({
      code: 'unknown',
      message: 'boom',
    });
  });

  it('maps a not-found lookup to the tool not_found error', async () => {
    const { runtime, service } = setup();
    service.get.mockRejectedValue(
      Object.assign(new Error('Webhook not found.'), { code: 'not_found' }),
    );
    expect((await runtime.deleteWebhook({ webhookId: ID })).state.error.code).toBe('not_found');
    expect(service.delete).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DecryptedConnector } from '@/database/models/connector';
import type { CreateInboundWebhook, InboundWebhookView } from '@/database/models/inboundWebhook';
import { InboundWebhookLimitError } from '@/database/models/inboundWebhook';
import { appEnv } from '@/envs/app';

import { McpEventsService } from './service';

const mocks = vi.hoisted(() => ({
  agentExists: vi.fn(),
  audit: vi.fn(),
  channelOrigin: vi.fn(),
  capability: vi.fn(),
  create: vi.fn(),
  enabled: vi.fn(),
  fresh: vi.fn(),
  links: vi.fn(),
  listEvents: vi.fn(),
  publicConnector: vi.fn(),
  remove: vi.fn(),
  resolve: vi.fn(),
  resolveAll: vi.fn(),
  rows: new Map<string, InboundWebhookView>(),
  subscribe: vi.fn(),
  topic: vi.fn(),
}));
vi.mock('@/database/models/agent', () => ({
  AgentModel: class {
    existsById = mocks.agentExists;
  },
}));
vi.mock('@/database/models/topic', () => ({
  TopicModel: class {
    findById = mocks.topic;
  },
}));
vi.mock('@/database/models/connector', () => ({
  ConnectorModel: class {
    resolveByIdentifiers = mocks.resolve;
    resolveAll = mocks.resolveAll;
    findPublicById = mocks.publicConnector;
    getLinkModel = () => ({ listByConnectorIds: mocks.links });
  },
}));
vi.mock('@/database/models/workspaceAuditLog', () => ({
  WorkspaceAuditLogModel: class {
    create = mocks.audit;
  },
}));
vi.mock('@/database/models/inboundWebhook', () => ({
  InboundWebhookLimitError: class extends Error {
    constructor(scope: string) {
      super(`Limit reached: ${scope}`);
    }
  },
  InboundWebhookModel: class {
    createWithLimits = mocks.create;
    async findById(id: string) {
      const row = mocks.rows.get(id);
      return row && structuredClone(row);
    }
    async query(input: { agentId?: string; topicId?: string; includeHidden?: boolean } = {}) {
      return [...mocks.rows.values()]
        .filter(
          (row) =>
            (!input.agentId || row.agentId === input.agentId) &&
            (!input.topicId || row.topicId === input.topicId) &&
            (input.includeHidden || !['pending', 'deleting'].includes(row.status)),
        )
        .map((row) => structuredClone(row));
    }
    async mergeState(id: string, state: object) {
      const row = mocks.rows.get(id)!;
      row.state = { ...row.state, ...state };
    }
    async mergeStateIf(id: string, state: object, expected: Record<string, unknown>) {
      const row = mocks.rows.get(id)!;
      if (
        Object.entries(expected).every(
          ([key, value]) => row.state[key as keyof typeof row.state] === value,
        )
      ) {
        row.state = { ...row.state, ...state };
      }
    }
    async update(id: string, update: object) {
      Object.assign(mocks.rows.get(id)!, update);
    }
    async updateIfStatus(id: string, update: object, statuses: string[], state: object = {}) {
      const stored = mocks.rows.get(id)!;
      if (!statuses.includes(stored.status)) return undefined;
      Object.assign(stored, update);
      stored.state = { ...stored.state, ...state };
      return structuredClone(stored);
    }
  },
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://lobehub.example.com' } }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/server/services/connector/sync', () => ({
  buildConnectorMcpParams: (connector: DecryptedConnector) => ({
    name: connector.identifier,
    type: 'http',
    url: connector.mcpServerUrl,
  }),
}));
vi.mock('@/server/services/connector/tokens', () => ({
  ensureFreshConnectorToken: mocks.fresh,
  ensureFreshLinkToken: async (_connector: unknown, link: unknown) => link,
}));
vi.mock('@/server/services/inboundWebhook/featureGate', () => ({
  isWebhookEnabled: mocks.enabled,
}));
vi.mock('@/server/services/mcp', () => ({
  mcpService: {
    getEventsCapability: mocks.capability,
    listEvents: mocks.listEvents,
    subscribeEvent: mocks.subscribe,
  },
}));
vi.mock('../../lifecycle', () => ({ removeInboundWebhook: mocks.remove }));
vi.mock('../../channelDelivery', () => ({ channelOriginOfRun: mocks.channelOrigin }));

const NOW = new Date('2026-11-13T10:00:00Z');
const connector = (patch: Partial<DecryptedConnector> = {}) =>
  ({
    id: 'connector',
    identifier: 'linear',
    name: 'Linear',
    isEnabled: true,
    mcpConnectionType: 'http',
    mcpServerUrl: 'https://linear.example.com/mcp',
    credentials: { type: 'bearer', token: 'example-token' },
    metadata: { capabilities: { events: { supported: true } } },
    ...patch,
  }) as DecryptedConnector;
const row = (patch: Partial<InboundWebhookView> = {}): InboundWebhookView => ({
  accessedAt: NOW,
  agentId: 'agent',
  config: { arguments: { team: 'web' }, eventName: 'issue.created' },
  connectorId: 'connector',
  createdAt: NOW,
  dedupeKey: null,
  id: 'webhook',
  instructions: 'Notify me',
  kind: 'mcp_events',
  lastDeliveryAt: null,
  lastError: null,
  maintenanceFailures: 0,
  name: 'issue.created',
  nextMaintenanceAt: null,
  state: { cursor: 'cursor-old', refreshBefore: null },
  status: 'active',
  topicId: 'topic',
  updatedAt: NOW,
  userId: 'user',
  verification: { scheme: 'standard_webhooks' },
  wakeCount: 0,
  wakeWindowStartedAt: NOW,
  workspaceId: null,
  ...patch,
});
const args = {
  agentId: 'agent',
  topicId: 'topic',
  connector: 'linear',
  name: 'issue.created',
  arguments: { team: 'web' },
  instructions: 'Notify me',
};
const service = (workspaceId?: string) => new McpEventsService({} as never, 'user', workspaceId);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.rows.clear();
  mocks.agentExists.mockResolvedValue(true);
  mocks.topic.mockResolvedValue({ id: 'topic', agentId: 'agent' });
  mocks.enabled.mockResolvedValue(true);
  mocks.resolve.mockResolvedValue([connector()]);
  mocks.resolveAll.mockResolvedValue([connector()]);
  mocks.publicConnector.mockResolvedValue(connector());
  mocks.fresh.mockImplementation(async (value) => value);
  mocks.links.mockResolvedValue([]);
  mocks.capability.mockResolvedValue({ supported: true });
  mocks.listEvents.mockResolvedValue([
    {
      name: 'issue.created',
      delivery: ['webhook'],
      inputSchema: { type: 'object', required: ['team'], properties: { team: { type: 'string' } } },
    },
  ]);
  mocks.subscribe.mockResolvedValue({ id: 'remote', refreshBefore: null });
  mocks.create.mockImplementation(async (input: CreateInboundWebhook) => {
    const created = row({ ...input, id: 'webhook', state: input.state ?? {} });
    mocks.rows.set(created.id, structuredClone(created));
    return created;
  });
  mocks.remove.mockImplementation(async (_db, target: InboundWebhookView) => {
    mocks.rows.delete(target.id);
  });
  mocks.audit.mockResolvedValue(undefined);
  appEnv.APP_URL = 'https://lobehub.example.com';
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('MCP event subscription service scope', () => {
  it('rejects every API while the feature is disabled', async () => {
    mocks.enabled.mockResolvedValue(false);
    await expect(
      service().listEventTypes({ agentId: 'agent', topicId: 'topic' }),
    ).rejects.toMatchObject({
      code: 'feature_disabled',
    });
    await expect(service().subscribeEvent(args)).rejects.toMatchObject({
      code: 'feature_disabled',
    });
    await expect(service().listSubscriptions(args)).rejects.toMatchObject({
      code: 'feature_disabled',
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('rejects an inaccessible agent or a topic owned by another agent', async () => {
    mocks.agentExists.mockResolvedValueOnce(false);
    await expect(
      service().listEventTypes({ agentId: 'other', topicId: 'topic' }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    mocks.topic.mockResolvedValueOnce({ id: 'topic', agentId: 'other' });
    await expect(service().subscribeEvent(args)).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses to subscribe in a Channel Topic outside a Channel job, where no Channel says where to post', async () => {
    mocks.topic.mockResolvedValue({ agentId: 'agent', id: 'topic', trigger: 'channel' });
    mocks.channelOrigin.mockResolvedValue(undefined);
    for (const call of [
      () => service().subscribeEvent(args),
      () => service().subscribeEvent({ ...args, operationId: 'op-unknown' }),
    ])
      await expect(call()).rejects.toMatchObject({ code: 'channel_unsupported' });
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('discovers events and lists subscriptions in a Channel Topic, before subscribing there', async () => {
    mocks.topic.mockResolvedValue({ agentId: 'agent', id: 'topic', trigger: 'channel' });
    mocks.channelOrigin.mockResolvedValue(undefined);
    const found = await service().listEventTypes({ agentId: 'agent', topicId: 'topic' });
    expect(found.eventTypes.map((event) => event.name)).toEqual(['issue.created']);
    await expect(service().listSubscriptions(args)).resolves.toMatchObject({ subscriptions: [] });
    expect(mocks.channelOrigin).not.toHaveBeenCalled();
  });

  it.each([
    { deliverTo: undefined, expected: { channelId: 'chn_1', threadId: 'cht_1' }, thread: 'cht_1' },
    { deliverTo: 'channel' as const, expected: { channelId: 'chn_1' }, thread: 'cht_1' },
    { deliverTo: undefined, expected: { channelId: 'chn_1' }, thread: null },
    { deliverTo: 'thread' as const, expected: { channelId: 'chn_1' }, thread: null },
  ])(
    'in a Channel run, posts results where the run answers (thread $thread, deliverTo $deliverTo)',
    async ({ deliverTo, expected, thread }) => {
      mocks.topic.mockResolvedValue({ agentId: 'agent', id: 'topic', trigger: 'channel' });
      mocks.channelOrigin.mockResolvedValue({ channelId: 'chn_1', threadId: thread });
      const result = await service().subscribeEvent({
        ...args,
        ...(deliverTo && { deliverTo }),
        operationId: 'op',
      });
      expect(mocks.channelOrigin).toHaveBeenCalledWith(expect.anything(), 'op');
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ delivery: expected }),
          topicId: 'topic',
        }),
      );
      expect(result.subscription.deliversTo).toBe(expected.threadId ? 'thread' : 'channel');
    },
  );

  it('names the subscription as the user asked, or after its event', async () => {
    const titled = await service().subscribeEvent({ ...args, title: '  Web bugs  ' });
    expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Web bugs' }));
    expect(titled.subscription.name).toBe('Web bugs');

    mocks.rows.clear();
    await service().subscribeEvent(args);
    expect(mocks.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'issue.created' }),
    );
  });

  it('keeps a Thread subscription and a main-timeline one of the same event apart', async () => {
    mocks.topic.mockResolvedValue({ agentId: 'agent', id: 'topic', trigger: 'channel' });
    mocks.channelOrigin.mockResolvedValue({ channelId: 'chn_1', threadId: 'cht_1' });
    await service().subscribeEvent({ ...args, operationId: 'op' });
    mocks.create.mockImplementationOnce(async (input: CreateInboundWebhook) => {
      const created = row({ ...input, id: 'webhook-2', state: input.state ?? {} });
      mocks.rows.set(created.id, structuredClone(created));
      return created;
    });
    await service().subscribeEvent({ ...args, deliverTo: 'channel', operationId: 'op' });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    const [first, second] = mocks.create.mock.calls.map(([input]) => input.dedupeKey);
    expect(first).not.toBe(second);
  });

  it('lists only subscriptions attached to the current agent and topic', async () => {
    for (const entry of [
      row(),
      row({ id: 'other-topic', topicId: 'other-topic' }),
      row({ id: 'other-agent', agentId: 'other-agent' }),
      row({ id: 'hidden', status: 'deleting' }),
    ])
      mocks.rows.set(entry.id, entry);
    const result = await service().listSubscriptions(args);
    expect(result.subscriptions.map((subscription) => subscription.id)).toEqual(['webhook']);
    expect(result.subscriptions[0]).not.toHaveProperty('secret');
  });
});

describe('creating an event subscription', () => {
  it('persists pending before subscribing, activates afterward, and returns a secret-free summary', async () => {
    mocks.subscribe.mockImplementationOnce(async (_params, input) => {
      expect(mocks.rows.get('webhook')?.status).toBe('pending');
      expect(input.ttlMs).toBeNull();
      expect(input.delivery.secret).toMatch(/^whsec_/);
      return { id: 'remote', refreshBefore: null };
    });
    const result = await service('workspace').subscribeEvent(args);
    expect(mocks.rows.get('webhook')).toMatchObject({
      status: 'active',
      nextMaintenanceAt: null,
      state: { remoteSubscriptionId: 'remote', refreshBefore: null },
    });
    expect(result.subscription).toMatchObject({
      id: 'webhook',
      status: 'active',
      expiresAt: null,
      connector: { identifier: 'linear', name: 'Linear' },
    });
    expect(result.subscription).not.toHaveProperty('secret');
    expect(mocks.resolve).toHaveBeenCalledWith(['linear'], 'agent');
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'webhook.created',
        metadata: { direction: 'inbound', kind: 'mcp_events' },
      }),
    );
  });

  it('rolls back the endpoint through lifecycle when the remote call fails', async () => {
    mocks.subscribe.mockRejectedValueOnce({ code: -32027 });
    await expect(service().subscribeEvent(args)).rejects.toMatchObject({
      code: 'callback_unreachable',
    });
    expect(mocks.rows.size).toBe(0);
    expect(mocks.remove).toHaveBeenCalledOnce();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each(['capability', 'listEvents'] as const)(
    'maps %s authentication failure before creating a local endpoint',
    async (stage) => {
      mocks[stage].mockRejectedValueOnce({ status: 401 });
      await expect(service().subscribeEvent(args)).rejects.toMatchObject({ code: 'forbidden' });
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.subscribe).not.toHaveBeenCalled();
    },
  );

  it('returns a quota error without calling the remote server or leaving a row', async () => {
    mocks.create.mockRejectedValueOnce(new InboundWebhookLimitError('topic'));
    await expect(service().subscribeEvent(args)).rejects.toMatchObject({ code: 'limit_reached' });
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.rows.size).toBe(0);
  });

  it.each([
    'http://lobehub.example.com',
    'https://localhost',
    'https://127.0.0.1',
    'https://192.168.1.10',
    'https://lobe.internal',
  ])('rejects a nonpublic callback origin: %s', async (url) => {
    appEnv.APP_URL = url;
    await expect(service().subscribeEvent(args)).rejects.toMatchObject({
      code: 'public_url_required',
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it.each([
    [[], 'connector_not_found'],
    [[connector({ isEnabled: false })], 'forbidden'],
    [[connector({ mcpConnectionType: 'stdio' })], 'events_unsupported'],
    [[connector({ mcpServerUrl: 'http://127.0.0.1/mcp' })], 'events_unsupported'],
    [[connector({ credentials: null })], 'forbidden'],
  ])('rejects unavailable or unauthenticated connector rows', async (connectors, code) => {
    mocks.resolve.mockResolvedValueOnce(connectors);
    await expect(service().subscribeEvent(args)).rejects.toMatchObject({ code });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects unsupported servers and event types that cannot deliver webhooks', async () => {
    mocks.capability.mockResolvedValueOnce({ supported: false });
    await expect(service().subscribeEvent(args)).rejects.toMatchObject({
      code: 'events_unsupported',
    });
    mocks.listEvents.mockResolvedValueOnce([{ name: args.name, delivery: ['poll'] }]);
    await expect(service().subscribeEvent(args)).rejects.toMatchObject({
      code: 'delivery_unsupported',
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('validates event arguments before creating a persistent trigger', async () => {
    await expect(
      service().subscribeEvent({ ...args, arguments: { team: 42 } }),
    ).rejects.toMatchObject({ code: 'invalid_arguments' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('deduplicates an identical event identity without renewing it', async () => {
    const first = await service().subscribeEvent({
      ...args,
      arguments: { team: 'web', filter: { state: 'open', label: 'bug' } },
    });
    const second = await service().subscribeEvent({
      ...args,
      arguments: { filter: { label: 'bug', state: 'open' }, team: 'web' },
    });
    expect(second).toEqual(first);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.subscribe).toHaveBeenCalledOnce();
  });
});

describe('event type discovery', () => {
  it('bounds connector reads while returning every topic subscription in order', async () => {
    for (let i = 0; i < 16; i++) {
      const stored = row({ id: `webhook-${i}`, status: 'active' });
      mocks.rows.set(stored.id, stored);
    }
    let active = 0;
    let maximum = 0;
    mocks.publicConnector.mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active--;
      return connector();
    });
    const result = await service().listSubscriptions({ agentId: 'agent', topicId: 'topic' });
    expect(result.subscriptions.map((entry) => entry.id)).toEqual([...mocks.rows.keys()]);
    expect(maximum).toBeLessThanOrEqual(5);
  });

  it('marks nonwebhook events unsubscribable and skips connectors without event capability', async () => {
    mocks.resolveAll.mockResolvedValue([
      connector(),
      connector({ id: 'no-events', identifier: 'no-events', metadata: {} }),
    ]);
    mocks.listEvents.mockResolvedValue([
      { name: 'issue.created', delivery: ['webhook'] },
      { name: 'stream', delivery: ['push'] },
    ]);
    expect(await service().listEventTypes({ agentId: 'agent', topicId: 'topic' })).toEqual({
      eventTypes: [
        {
          connector: { identifier: 'linear', name: 'Linear' },
          description: undefined,
          inputSchema: undefined,
          name: 'issue.created',
          subscribable: true,
        },
        {
          connector: { identifier: 'linear', name: 'Linear' },
          description: undefined,
          inputSchema: undefined,
          name: 'stream',
          subscribable: false,
        },
      ],
    });
    expect(mocks.listEvents).toHaveBeenCalledOnce();
  });

  it('keeps errors per connector so other event types can still be listed', async () => {
    mocks.resolveAll.mockResolvedValue([
      connector(),
      connector({ id: 'other', identifier: 'other' }),
    ]);
    mocks.listEvents.mockRejectedValueOnce({ code: -32024 });
    const result = await service().listEventTypes({ agentId: 'agent', topicId: 'topic' });
    expect(result.eventTypes).toHaveLength(1);
    expect(result.errors).toEqual([
      { connector: 'linear', message: expect.stringMatching(/Reconnect/) },
    ]);
  });
});

describe('OAuth connectors with accounts', () => {
  // Since connector accounts, an OAuth connector row has no credentials of its own.
  const oauth = connector({ credentials: null, oidcConfig: { clientId: 'client' } as never });
  beforeEach(() => {
    mocks.resolve.mockResolvedValue([oauth]);
    mocks.resolveAll.mockResolvedValue([oauth]);
    mocks.links.mockResolvedValue([
      {
        credentials: { accessToken: 'alice-token', type: 'oauth2' },
        id: 'lnk_a',
        status: 'connected',
        userConnectorId: 'connector',
      },
    ]);
  });

  it('lists event types through the connected account', async () => {
    const state = await service().listEventTypes({ agentId: 'agent', topicId: 'topic' });
    expect(state.errors).toBeUndefined();
    expect(state.eventTypes.map((event) => event.name)).toEqual(['issue.created']);
  });

  it('subscribes through the connected account and remembers it', async () => {
    await expect(service().subscribeEvent(args)).resolves.toMatchObject({
      subscription: { status: 'active' },
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { arguments: { team: 'web' }, eventName: 'issue.created', linkId: 'lnk_a' },
      }),
    );
  });

  it('still asks for authentication when the connector has no account', async () => {
    mocks.links.mockResolvedValue([]);
    await expect(service().subscribeEvent(args)).rejects.toMatchObject({
      message: 'Authenticate this connector before subscribing to events.',
    });
  });
});

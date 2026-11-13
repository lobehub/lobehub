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
  capability: vi.fn(),
  create: vi.fn(),
  enabled: vi.fn(),
  fresh: vi.fn(),
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
vi.mock('@/server/services/connector/tokens', () => ({ ensureFreshConnectorToken: mocks.fresh }));
vi.mock('@/server/services/mcp/featureGate', () => ({ isMcpEventsEnabled: mocks.enabled }));
vi.mock('@/server/services/mcp', () => ({
  mcpService: {
    getEventsCapability: mocks.capability,
    listEvents: mocks.listEvents,
    subscribeEvent: mocks.subscribe,
  },
}));
vi.mock('../../lifecycle', () => ({ removeInboundWebhook: mocks.remove }));

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
    await expect(service().listEventTypes({ agentId: 'agent' })).rejects.toMatchObject({
      code: 'feature_disabled',
    });
    await expect(service().subscribeEvent(args)).rejects.toMatchObject({
      code: 'feature_disabled',
    });
    await expect(service().listSubscriptions(args)).rejects.toMatchObject({
      code: 'feature_disabled',
    });
    await expect(
      service().unsubscribeEvent({ ...args, subscriptionId: 'webhook' }),
    ).rejects.toMatchObject({ code: 'feature_disabled' });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it('rejects an inaccessible agent or a topic owned by another agent', async () => {
    mocks.agentExists.mockResolvedValueOnce(false);
    await expect(service().listEventTypes({ agentId: 'other' })).rejects.toMatchObject({
      code: 'forbidden',
    });
    mocks.topic.mockResolvedValueOnce({ id: 'topic', agentId: 'other' });
    await expect(service().subscribeEvent(args)).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([{ topicId: 'other-topic' }, { agentId: 'other-agent' }, { userId: 'other-user' }])(
    'cannot unsubscribe a row outside this topic/agent/creator: %j',
    async (patch) => {
      mocks.rows.set('webhook', row(patch));
      await expect(
        service().unsubscribeEvent({ ...args, subscriptionId: 'webhook' }),
      ).rejects.toMatchObject({ code: 'not_found' });
      expect(mocks.rows.has('webhook')).toBe(true);
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );

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

  it('removes an owned subscription and records workspace deletion audit', async () => {
    mocks.rows.set('webhook', row({ workspaceId: 'workspace' }));
    expect(
      await service('workspace').unsubscribeEvent({ ...args, subscriptionId: 'webhook' }),
    ).toEqual({ removed: true, subscriptionId: 'webhook' });
    expect(mocks.rows.size).toBe(0);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'webhook.deleted',
        resourceType: 'webhook',
        workspaceId: 'workspace',
        metadata: { direction: 'inbound', kind: 'mcp_events' },
      }),
    );
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
    expect(await service().listEventTypes({ agentId: 'agent' })).toEqual({
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
    const result = await service().listEventTypes({ agentId: 'agent' });
    expect(result.eventTypes).toHaveLength(1);
    expect(result.errors).toEqual([
      { connector: 'linear', message: expect.stringMatching(/Reconnect/) },
    ]);
  });
});

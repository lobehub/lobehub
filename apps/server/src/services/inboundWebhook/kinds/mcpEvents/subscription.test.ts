// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InboundWebhookModel, InboundWebhookView } from '@/database/models/inboundWebhook';
import type { McpSubscribeEventParams } from '@/libs/mcp/events/schema';

import type { InboundWebhookContext } from '../types';
import {
  applySubscriptionResult,
  maintainMcpSubscription,
  maintenanceBackoff,
  refreshSubscription,
  subscribeRemote,
  teardownMcpSubscription,
} from './subscription';

const mocks = vi.hoisted(() => ({
  connector: vi.fn(),
  fresh: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  updateStatus: vi.fn(),
}));
vi.mock('@/database/models/connector', () => ({
  ConnectorModel: class {
    findById = mocks.connector;
    updateStatus = mocks.updateStatus;
  },
}));
vi.mock('@/envs/app', () => ({ appEnv: { APP_URL: 'https://lobehub.example.com' } }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: async () => ({}) },
}));
vi.mock('@/server/services/connector/sync', () => ({
  buildConnectorMcpParams: (connector: { identifier: string; mcpServerUrl: string }) => ({
    name: connector.identifier,
    type: 'http',
    url: connector.mcpServerUrl,
  }),
}));
vi.mock('@/server/services/connector/tokens', () => ({ ensureFreshConnectorToken: mocks.fresh }));
vi.mock('@/server/services/mcp', () => ({
  mcpService: { subscribeEvent: mocks.subscribe, unsubscribeEvent: mocks.unsubscribe },
}));

const NOW = new Date('2026-11-13T10:00:00Z');
const connection = { name: 'linear', type: 'http' as const, url: 'https://linear.example.com/mcp' };
const remoteInput: McpSubscribeEventParams = {
  arguments: { team: 'web' },
  cursor: null,
  delivery: {
    mode: 'webhook',
    secret: 'whsec_example',
    url: 'https://lobehub.example.com/api/webhooks/inbound/id',
  },
  name: 'issue.created',
  ttlMs: null,
};

const createContext = (patch: Partial<InboundWebhookView> = {}) => {
  const row: InboundWebhookView = {
    accessedAt: NOW,
    agentId: 'agent',
    config: { arguments: { team: 'web' }, eventName: 'issue.created' },
    connectorId: 'connector',
    createdAt: NOW,
    dedupeKey: 'dedupe',
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
  };
  const stored = structuredClone(row);
  const model = {
    findById: vi.fn(async () => stored),
    getSecret: vi.fn().mockResolvedValue('whsec_example'),
    mergeState: vi.fn(async (_id, state) => {
      stored.state = { ...stored.state, ...state };
      return stored;
    }),
    mergeStateIf: vi.fn(async (_id, state, expected) => {
      if (
        Object.entries(expected).every(
          ([key, value]) => stored.state[key as keyof typeof stored.state] === value,
        )
      ) {
        stored.state = { ...stored.state, ...state };
        return stored;
      }
      return undefined;
    }),
    update: vi.fn(async (_id, update) => {
      Object.assign(stored, update);
      return stored;
    }),
  };
  const ctx: InboundWebhookContext = {
    db: {} as never,
    model: model as unknown as InboundWebhookModel,
    row,
  };
  return { ctx, model, stored };
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.connector.mockResolvedValue({
    identifier: 'linear',
    isEnabled: true,
    mcpServerUrl: connection.url,
  });
  mocks.fresh.mockImplementation(async (connector) => connector);
  mocks.subscribe.mockResolvedValue({ id: 'remote', refreshBefore: null });
  mocks.unsubscribe.mockResolvedValue({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('remote event subscription compatibility', () => {
  it('requests indefinite lifetime by sending ttlMs:null', async () => {
    await subscribeRemote(connection, remoteInput);
    expect(mocks.subscribe).toHaveBeenCalledOnce();
    expect(mocks.subscribe.mock.calls[0][1]).toMatchObject({ ttlMs: null, cursor: null });
  });

  it('retries InvalidParams once without ttlMs, keeping subscription identity and replay cursor', async () => {
    mocks.subscribe.mockRejectedValueOnce({ code: -32602 });
    await subscribeRemote(connection, remoteInput);
    expect(mocks.subscribe).toHaveBeenCalledTimes(2);
    const fallback = mocks.subscribe.mock.calls[1][1];
    expect(fallback).not.toHaveProperty('ttlMs');
    const { ttlMs: _ttl, ...identity } = remoteInput;
    expect(fallback).toEqual(identity);
  });

  it('does not retry a second InvalidParams or an explicit finite TTL', async () => {
    mocks.subscribe.mockRejectedValue({ code: -32602 });
    await expect(subscribeRemote(connection, remoteInput)).rejects.toMatchObject({ code: -32602 });
    expect(mocks.subscribe).toHaveBeenCalledTimes(2);
    mocks.subscribe.mockClear();
    await expect(
      subscribeRemote(connection, { ...remoteInput, ttlMs: 60_000 }),
    ).rejects.toMatchObject({ code: -32602 });
    expect(mocks.subscribe).toHaveBeenCalledOnce();
  });

  it('does not retry forbidden or network failures', async () => {
    mocks.subscribe.mockRejectedValueOnce({ code: -32024 });
    await expect(subscribeRemote(connection, remoteInput)).rejects.toMatchObject({ code: -32024 });
    expect(mocks.subscribe).toHaveBeenCalledOnce();
  });
});

describe('subscription maintenance', () => {
  it('keeps an indefinite subscription out of maintenance and merges its identity/cursor', async () => {
    const { ctx, stored } = createContext();
    await applySubscriptionResult(ctx, { id: 'remote', cursor: 'cursor-new', refreshBefore: null });
    expect(stored.status).toBe('active');
    expect(stored.nextMaintenanceAt).toBeNull();
    expect(stored.state).toMatchObject({
      remoteSubscriptionId: 'remote',
      cursor: 'cursor-new',
      refreshBefore: null,
    });
  });

  it('renews finite subscriptions halfway through their grant and carries cursor/maxAge', async () => {
    const { ctx, stored } = createContext();
    const refreshBefore = new Date(NOW.getTime() + 120_000).toISOString();
    mocks.subscribe.mockResolvedValue({ id: 'remote', cursor: 'cursor-next', refreshBefore });
    await refreshSubscription(ctx);
    expect(mocks.subscribe.mock.calls[0][1]).toMatchObject({
      cursor: 'cursor-old',
      maxAgeMs: 3_600_000,
      ttlMs: null,
      delivery: {
        mode: 'webhook',
        secret: 'whsec_example',
        url: 'https://lobehub.example.com/api/webhooks/inbound/webhook',
      },
    });
    expect(stored.nextMaintenanceAt).toEqual(new Date(NOW.getTime() + 60_000));
    expect(stored.state).toMatchObject({ cursor: 'cursor-next', refreshBefore });
  });

  it('preserves a cursor received during the upstream subscribe request', async () => {
    const { ctx, stored } = createContext();
    stored.state.cursor = 'arrived-during-subscribe';
    await applySubscriptionResult(ctx, {
      id: 'remote',
      cursor: 'older-response-cursor',
      refreshBefore: null,
      truncated: true,
    });
    expect(stored.state.cursor).toBe('arrived-during-subscribe');
    expect(stored.state.truncated).toBe(true);
  });

  it('does not overwrite a delivery cursor that advances between context capture and SQL update', async () => {
    const { ctx, model, stored } = createContext();
    const compareAndSwap = model.mergeStateIf.getMockImplementation()!;
    model.mergeStateIf.mockImplementationOnce(async (...params) => {
      stored.state.cursor = 'receipt-won-the-race';
      return compareAndSwap(...params);
    });
    await applySubscriptionResult(ctx, {
      id: 'remote',
      cursor: 'stale-subscribe-response',
      refreshBefore: null,
    });
    expect(stored.state.cursor).toBe('receipt-won-the-race');
    expect(stored.state.remoteSubscriptionId).toBe('remote');
  });

  it.each([
    [{ status: 401 }, 'auth'],
    [{ cause: { statusCode: 401 } }, 'auth'],
    [{ code: -32024 }, 'auth'],
    [new Error('Connection failed'), 'server_unreachable'],
  ])('records recoverable refresh errors with backoff: %j', async (error, lastError) => {
    const { ctx, stored } = createContext({ maintenanceFailures: 2 });
    mocks.subscribe.mockRejectedValueOnce(error);
    await maintainMcpSubscription(ctx);
    expect(stored).toMatchObject({ status: 'error', lastError, maintenanceFailures: 3 });
    expect(stored.nextMaintenanceAt).toEqual(new Date(NOW.getTime() + maintenanceBackoff(3)));
    if (lastError === 'auth') expect(mocks.updateStatus).toHaveBeenCalledWith('connector', 'error');
    else expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it('caps exponential maintenance backoff at six hours', () => {
    expect(maintenanceBackoff(100)).toBeLessThanOrEqual(6 * 3_600_000);
    expect(maintenanceBackoff(1)).toBeLessThan(maintenanceBackoff(2));
  });

  it.each([
    [null, null],
    ['2026-11-13T10:01:00Z', new Date(NOW.getTime() + 300_000)],
  ])('does not renew disabled connectors (%s)', async (refreshBefore, nextMaintenanceAt) => {
    mocks.connector.mockResolvedValue({
      identifier: 'linear',
      isEnabled: false,
      mcpServerUrl: connection.url,
    });
    const { ctx, stored } = createContext({ state: { refreshBefore } });
    await refreshSubscription(ctx);
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.fresh).not.toHaveBeenCalled();
    expect(stored.nextMaintenanceAt).toEqual(nextMaintenanceAt);
  });

  it.each([
    [{ active: false }, 'delivery_suspended'],
    [{ active: true, lastError: 'tls_error' }, 'tls_error'],
    [{ active: true, lastError: 'future-error-code' }, 'unknown'],
  ])('returns reported delivery problems in the row: %j', async (deliveryStatus, lastError) => {
    const { ctx, stored } = createContext();
    await applySubscriptionResult(ctx, { id: 'remote', refreshBefore: null, deliveryStatus });
    expect(stored).toMatchObject({ status: 'error', lastError });
    expect(stored.state.deliveryStatus).toEqual(deliveryStatus);
  });

  it.each([
    [{ status: 401 }, true],
    [new Error('socket hang up'), false],
  ])(
    'keeps an ended subscription ended when an explicit check fails: %j',
    async (error, flagsConnector) => {
      mocks.subscribe.mockRejectedValue(error);
      const { ctx, model, stored } = createContext({
        lastError: 'access_revoked',
        status: 'terminated',
      });
      await maintainMcpSubscription(ctx);
      // The server ended it: a failed check must neither relabel it nor schedule retries.
      expect(stored).toMatchObject({
        lastError: 'access_revoked',
        maintenanceFailures: 0,
        nextMaintenanceAt: null,
        status: 'terminated',
      });
      expect(model.update).not.toHaveBeenCalled();
      // Broken credentials are still surfaced where the user fixes them.
      if (flagsConnector) expect(mocks.updateStatus).toHaveBeenCalledWith('connector', 'error');
      else expect(mocks.updateStatus).not.toHaveBeenCalled();
    },
  );

  it('revives an ended subscription when an explicit check succeeds', async () => {
    const { ctx, stored } = createContext({ lastError: 'access_revoked', status: 'terminated' });
    await maintainMcpSubscription(ctx);
    expect(stored).toMatchObject({ lastError: null, status: 'active' });
  });

  it('clears a previous error once a manual check resumes delivery', async () => {
    const { ctx, stored } = createContext({
      status: 'error',
      lastError: 'auth',
      maintenanceFailures: 3,
    });
    await maintainMcpSubscription(ctx);
    expect(stored).toMatchObject({
      status: 'active',
      lastError: null,
      maintenanceFailures: 0,
      nextMaintenanceAt: null,
    });
  });
});

describe('remote teardown', () => {
  it('treats an already missing subscription as successfully removed', async () => {
    mocks.unsubscribe.mockRejectedValueOnce({ code: -32023 });
    await expect(teardownMcpSubscription(createContext().ctx)).resolves.toBeUndefined();
  });

  it('preserves upstream failures so lifecycle can retry teardown', async () => {
    mocks.unsubscribe.mockRejectedValueOnce(new Error('Network unavailable'));
    await expect(teardownMcpSubscription(createContext().ctx)).rejects.toThrow(
      'Network unavailable',
    );
  });
});

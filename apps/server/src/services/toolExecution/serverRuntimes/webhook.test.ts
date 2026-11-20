// @vitest-environment node
import { WebhookIdentifier } from '@lobechat/builtin-tool-webhook';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../types';
import { getServerRuntime, hasServerRuntime } from './index';
import { webhookRuntime } from './webhook';

const ID = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
  channelOriginOfRun: vi.fn(),
  construct: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
}));
vi.mock('@/server/services/inboundWebhook/manage', () => ({
  InboundWebhookManager: class {
    constructor(...args: unknown[]) {
      mocks.construct(...args);
    }
    create = mocks.create;
    get = mocks.get;
    list = mocks.list;
  },
}));
vi.mock('@/server/services/inboundWebhook/channelDelivery', () => ({
  channelOriginOfRun: mocks.channelOriginOfRun,
}));

const context: ToolExecutionContext = {
  agentId: 'agent',
  operationId: 'op-1',
  serverDB: {} as never,
  topicId: 'topic',
  toolManifestMap: {},
  userId: 'user',
  workspaceId: 'workspace',
};

const item = {
  agent: { avatar: null, backgroundColor: null, id: 'agent', title: null },
  canCheck: false,
  canConfigure: true,
  canManage: true,
  channel: null,
  connector: null,
  createdAt: '2026-11-17T00:00:00.000Z',
  creatorId: 'user',
  endpoint: 'https://app.example.com/hook',
  expiresAt: null,
  id: ID,
  identifier: 'webhook',
  instructions: null,
  kind: 'generic',
  lastDeliveryAt: null,
  lastError: null,
  name: null,
  source: { autoApprove: true, kind: 'generic', topicMode: 'new' },
  status: 'active',
  topic: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('webhook tool server runtime', () => {
  it('is registered under the tool identifier', () => {
    expect(hasServerRuntime(WebhookIdentifier)).toBe(true);
    expect(getServerRuntime(WebhookIdentifier, context)).toBeDefined();
  });

  it.each(['serverDB', 'userId', 'agentId'] as const)(
    'requires %s from the trusted execution context',
    (field) => {
      expect(() => webhookRuntime.factory({ ...context, [field]: undefined })).toThrow(
        'signed-in owner',
      );
      expect(mocks.construct).not.toHaveBeenCalled();
    },
  );

  it('refuses a share visitor run', () => {
    expect(() =>
      webhookRuntime.factory({
        ...context,
        agentShareVisitor: { shareId: 's', visitorUserId: 'v' } as never,
      }),
    ).toThrow('signed-in owner');
    expect(mocks.construct).not.toHaveBeenCalled();
  });

  it('manages as the user without workspace admin powers, delivering to the run’s Channel', async () => {
    mocks.channelOriginOfRun.mockResolvedValue({ channelId: 'ch', threadId: 'cht' });
    mocks.create.mockResolvedValue({ item, secret: 'whk_secret' });

    const runtime = webhookRuntime.factory(context);
    const result = await runtime.createWebhook({ instructions: 'Triage' });

    expect(mocks.construct).toHaveBeenCalledWith(context.serverDB, {
      userId: 'user',
      workspaceId: 'workspace',
    });
    expect(mocks.channelOriginOfRun).toHaveBeenCalledWith(context.serverDB, 'op-1');
    expect(mocks.create).toHaveBeenCalledWith({
      agentId: 'agent',
      autoApprove: true,
      delivery: { channelId: 'ch', threadId: 'cht' },
      instructions: 'Triage',
    });
    expect(result.success).toBe(true);
    expect(JSON.stringify(result)).not.toContain('whk_secret');
  });

  it('has no Channel origin without an operation', async () => {
    mocks.create.mockResolvedValue({ item, secret: 'whk_secret' });
    const runtime = webhookRuntime.factory({ ...context, operationId: undefined });
    const result = await runtime.createWebhook({ deliverTo: 'channel' });
    expect(result.state.error.code).toBe('not_in_channel');
    expect(mocks.channelOriginOfRun).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('lists only custom webhooks: MCP Events subscriptions belong to their own tool', async () => {
    mocks.list.mockResolvedValue([
      item,
      {
        ...item,
        id: 'sub',
        kind: 'mcp_events',
        source: { arguments: {}, eventName: 'e', kind: 'mcp_events' },
      },
    ]);
    const runtime = webhookRuntime.factory(context);
    const result = await runtime.listWebhooks();
    expect(mocks.list).toHaveBeenCalledWith({ agentId: 'agent', kind: 'generic' });
    expect(result.state.webhooks).toEqual([
      expect.objectContaining({ id: ID, identifier: 'webhook' }),
    ]);
  });
});

// @vitest-environment node
import { McpEventsIdentifier } from '@lobechat/builtin-tool-mcp-events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../types';
import { getServerRuntime, hasServerRuntime } from './index';
import { mcpEventsRuntime } from './mcpEvents';

const ID = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
  constructManager: vi.fn(),
  constructService: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  listSubscriptions: vi.fn(),
}));
vi.mock('@/server/services/inboundWebhook/kinds/mcpEvents/service', () => ({
  McpEventsService: class {
    constructor(...args: unknown[]) {
      mocks.constructService(...args);
    }
    listSubscriptions = mocks.listSubscriptions;
  },
}));
vi.mock('@/server/services/inboundWebhook/manage', () => ({
  InboundWebhookManager: class {
    constructor(...args: unknown[]) {
      mocks.constructManager(...args);
    }
    delete = mocks.delete;
    get = mocks.get;
    list = mocks.list;
  },
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

const subscription = (overrides: Record<string, unknown> = {}) => ({
  agent: { avatar: null, backgroundColor: null, id: 'agent', title: null },
  canCheck: true,
  canConfigure: true,
  canManage: true,
  channel: null,
  connector: { agentId: null, avatar: null, id: 'c1', identifier: 'linear', name: 'Linear' },
  createdAt: '2026-11-17T00:00:00.000Z',
  creatorId: 'user',
  endpoint: null,
  expiresAt: null,
  id: ID,
  identifier: 'issue.created',
  instructions: 'Triage',
  kind: 'mcp_events',
  lastDeliveryAt: null,
  lastError: null,
  name: 'Web bugs',
  source: { arguments: {}, eventName: 'issue.created', kind: 'mcp_events' },
  status: 'active',
  topic: { id: 'topic-other', title: 'Other topic' },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MCP Events server runtime registration', () => {
  it('is registered under the tool identifier', () => {
    expect(hasServerRuntime(McpEventsIdentifier)).toBe(true);
    expect(getServerRuntime(McpEventsIdentifier, context)).toBeDefined();
  });

  it.each(['serverDB', 'userId', 'agentId', 'topicId'] as const)(
    'requires %s from the trusted execution context',
    (field) => {
      expect(() => mcpEventsRuntime.factory({ ...context, [field]: undefined })).toThrow(
        'authenticated agent and topic',
      );
      expect(mocks.constructService).not.toHaveBeenCalled();
      expect(mocks.constructManager).not.toHaveBeenCalled();
    },
  );

  it('refuses a share visitor run', () => {
    expect(() =>
      mcpEventsRuntime.factory({
        ...context,
        agentShareVisitor: { shareId: 's', visitorUserId: 'v' } as never,
      }),
    ).toThrow('authenticated agent and topic');
    expect(mocks.constructManager).not.toHaveBeenCalled();
  });

  it('binds topic listing to the executing agent and topic', async () => {
    mocks.listSubscriptions.mockResolvedValue({ subscriptions: [] });
    const runtime = mcpEventsRuntime.factory(context);
    expect((await runtime.listSubscriptions({ agentId: 'other', topicId: 'other' })).success).toBe(
      true,
    );
    expect(mocks.constructService).toHaveBeenCalledWith(context.serverDB, 'user', 'workspace');
    expect(mocks.listSubscriptions).toHaveBeenCalledWith({
      agentId: 'agent',
      operationId: 'op-1',
      topicId: 'topic',
    });
  });

  it('manages agent-wide as the user, without workspace admin powers', async () => {
    mocks.get.mockResolvedValue(subscription());
    mocks.delete.mockResolvedValue({ success: true });
    const runtime = mcpEventsRuntime.factory(context);
    const result = await runtime.unsubscribeEvent({
      agentId: 'other',
      subscriptionId: ID,
      topicId: 'other',
    });
    expect(result.success).toBe(true);
    expect(mocks.constructManager).toHaveBeenCalledWith(context.serverDB, {
      userId: 'user',
      workspaceId: 'workspace',
    });
    // A subscription in another topic of this agent, made by this user.
    expect(mocks.delete).toHaveBeenCalledWith(ID);
  });

  it("refuses another member's subscription on the same agent", async () => {
    mocks.get.mockResolvedValue(subscription({ creatorId: 'colleague' }));
    const runtime = mcpEventsRuntime.factory(context);
    const result = await runtime.unsubscribeEvent({ subscriptionId: ID });
    expect(result.state.error.code).toBe('not_found');
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});

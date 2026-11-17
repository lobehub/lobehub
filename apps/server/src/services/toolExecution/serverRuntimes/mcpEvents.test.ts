// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../types';
import { mcpEventsRuntime } from './mcpEvents';

const mocks = vi.hoisted(() => ({ create: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('@/server/services/inboundWebhook/kinds/mcpEvents/service', () => ({
  McpEventsService: class {
    constructor(...args: unknown[]) {
      mocks.create(...args);
    }
    unsubscribeEvent = mocks.unsubscribe;
  },
}));

const context: ToolExecutionContext = {
  agentId: 'agent',
  serverDB: {} as never,
  topicId: 'topic',
  toolManifestMap: {},
  userId: 'user',
  workspaceId: 'workspace',
};
beforeEach(() => {
  vi.clearAllMocks();
});

describe('MCP Events server runtime registration', () => {
  it.each(['serverDB', 'userId', 'agentId', 'topicId'] as const)(
    'requires %s from the trusted execution context',
    (field) => {
      expect(() => mcpEventsRuntime.factory({ ...context, [field]: undefined })).toThrow(
        'authenticated agent and topic',
      );
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it('uses the authenticated principal and binds the executing topic', async () => {
    mocks.unsubscribe.mockResolvedValue({ removed: true, subscriptionId: 'webhook' });
    const runtime = mcpEventsRuntime.factory(context);
    const result = await runtime.unsubscribeEvent({
      subscriptionId: 'webhook',
      agentId: 'other',
      topicId: 'other',
    });
    expect(result.success).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith(context.serverDB, 'user', 'workspace');
    expect(mocks.unsubscribe).toHaveBeenCalledWith({
      agentId: 'agent',
      topicId: 'topic',
      subscriptionId: 'webhook',
    });
  });
});

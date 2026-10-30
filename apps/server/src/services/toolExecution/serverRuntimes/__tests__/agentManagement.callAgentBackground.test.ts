import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentManagementRuntime } from '../agentManagement';

const { mockGetAgentConfigById, mockListBackgroundSubAgentCalls } = vi.hoisted(() => ({
  mockGetAgentConfigById: vi.fn(),
  mockListBackgroundSubAgentCalls: vi.fn(),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return { listBackgroundSubAgentCalls: mockListBackgroundSubAgentCalls };
  }),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn(function () {
    return { getAgentConfigById: mockGetAgentConfigById };
  }),
}));

vi.mock('@/database/models/plugin', () => ({ PluginModel: vi.fn() }));
vi.mock('@/database/models/connector', () => ({ ConnectorModel: vi.fn() }));
vi.mock('@/server/services/agent', () => ({ AgentService: vi.fn() }));
vi.mock('@/server/services/discover', () => ({ DiscoverService: vi.fn() }));

const createRuntime = () =>
  agentManagementRuntime.factory({
    serverDB: {} as never,
    toolManifestMap: {},
    userId: 'user-1',
  });

describe('agentManagementRuntime callAgent', () => {
  describe('runInBackground', () => {
    const topicCtx = { topicId: 'topic-1', toolManifestMap: {} };

    beforeEach(() => {
      mockListBackgroundSubAgentCalls.mockResolvedValue([]);
      mockGetAgentConfigById.mockResolvedValue({ title: 'Poet' });
    });

    // The reply arrives later as a message from the target; the caller keeps going.
    it('returns the start receipt at once, written into the runner placeholder', async () => {
      const run = vi.fn().mockResolvedValue({
        started: true,
        subOperationId: 'op-child',
        threadId: 'thread-child',
        toolMessageId: 'placeholder-1',
      });
      const runtime = createRuntime();

      const result = await runtime.callAgent(
        { agentId: 'agent-target', instruction: 'Write a poem', runInBackground: true },
        { ...topicCtx, subAgent: { run } },
      );

      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ background: true, description: 'Poet' }),
      );
      expect(result.deferred).toBeUndefined();
      expect(result).toMatchObject({ success: true, toolMessageId: 'placeholder-1' });
      expect(result.content).toContain('Started in the background');
      // A callAgent target cannot be continued with subAgentId, so no handle.
      expect(result.content).not.toContain('<sub_agent');
    });

    it('refuses in a group conversation without starting anything', async () => {
      const run = vi.fn();
      const runtime = createRuntime();

      const result = await runtime.callAgent(
        { agentId: 'agent-target', instruction: 'Write a poem', runInBackground: true },
        { ...topicCtx, groupId: 'group-1', subAgent: { run } },
      );

      expect(result).toMatchObject({
        error: { code: 'BACKGROUND_SUB_AGENT_UNSUPPORTED' },
        success: false,
      });
      expect(run).not.toHaveBeenCalled();
    });
  });
});

import { LEGACY_CALL_AGENT_NOTE } from '@lobechat/builtin-tool-lobe-agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentManagementRuntime } from '../agentManagement';

const { mockGetAgentConfigById, mockListBackgroundSubAgentCalls, mockThreadFindById } = vi.hoisted(
  () => ({
    mockGetAgentConfigById: vi.fn(),
    mockListBackgroundSubAgentCalls: vi.fn(),
    mockThreadFindById: vi.fn(),
  }),
);

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

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn(function () {
    return { findById: mockThreadFindById };
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

const topicCtx = { agentId: 'agent-caller', topicId: 'topic-1', toolManifestMap: {} };

// `callAgent` is retired: it no longer reaches the model, but calls from old
// prompts and cached tool lists forward to `callSubAgent({ agentId })`.
describe('agentManagementRuntime callAgent alias', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListBackgroundSubAgentCalls.mockResolvedValue([]);
    mockGetAgentConfigById.mockResolvedValue({ title: 'Poet' });
    mockThreadFindById.mockResolvedValue(undefined);
  });

  it('forwards to callSubAgent with the target agent and defers like it', async () => {
    const run = vi.fn().mockResolvedValue({
      started: true,
      subOperationId: 'op-child',
      threadId: 'thread-child',
    });

    const result = await createRuntime().callAgent(
      { agentId: 'agent-target', instruction: 'Write a poem' },
      { ...topicCtx, subAgent: { run } },
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-target',
        background: false,
        description: 'Poet',
        instruction: 'Write a poem',
        senderName: 'Poet',
      }),
    );
    expect(result).toMatchObject({ content: '', deferred: true, success: true });
    expect(result.state).toMatchObject({
      status: 'pending',
      targetAgentId: 'agent-target',
      threadId: 'thread-child',
    });
  });

  it('asks the model to switch on an immediate result', async () => {
    const run = vi.fn().mockResolvedValue({ error: 'boom', started: false, threadId: '' });

    const result = await createRuntime().callAgent(
      { agentId: 'agent-target', instruction: 'Write a poem' },
      { ...topicCtx, subAgent: { run } },
    );

    expect(result).toMatchObject({ error: { code: 'SUB_AGENT_START_FAILED' }, success: false });
    expect(result.content).toBe(`Agent "Poet" failed to start: boom\n\n${LEGACY_CALL_AGENT_NOTE}`);
  });

  it('refuses a target the user cannot access', async () => {
    mockGetAgentConfigById.mockResolvedValue(null);
    const run = vi.fn();

    const result = await createRuntime().callAgent(
      { agentId: 'agent-foreign', instruction: 'Write a poem' },
      { ...topicCtx, subAgent: { run } },
    );

    expect(result).toMatchObject({ error: { code: 'AGENT_NOT_FOUND' }, success: false });
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects nested execution', async () => {
    const run = vi.fn();

    const result = await createRuntime().callAgent(
      { agentId: 'agent-target', instruction: 'Write a poem' },
      { ...topicCtx, isSubAgent: true, subAgent: { run } },
    );

    expect(result).toMatchObject({ error: { code: 'NESTED_SUB_AGENT_NOT_ALLOWED' } });
    expect(run).not.toHaveBeenCalled();
  });

  describe('runInBackground', () => {
    // The reply arrives later as a message from the target; the caller keeps going.
    it('returns the start receipt with the follow-up handle', async () => {
      const run = vi.fn().mockResolvedValue({
        started: true,
        subOperationId: 'op-child',
        threadId: 'thread-child',
        toolMessageId: 'placeholder-1',
      });

      const result = await createRuntime().callAgent(
        { agentId: 'agent-target', instruction: 'Write a poem', runInBackground: true },
        { ...topicCtx, subAgent: { run } },
      );

      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ background: true, description: 'Poet', senderName: 'Poet' }),
      );
      expect(result.deferred).toBeUndefined();
      expect(result).toMatchObject({ success: true, toolMessageId: 'placeholder-1' });
      expect(result.content).toContain('Started in the background');
      expect(result.content).toContain(LEGACY_CALL_AGENT_NOTE);
      // Now continuable like any sub-agent; the handle stays last.
      expect(result.content.endsWith('<sub_agent id="thread-child" />')).toBe(true);
    });

    it('refuses in a group conversation without starting anything', async () => {
      const run = vi.fn();

      const result = await createRuntime().callAgent(
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

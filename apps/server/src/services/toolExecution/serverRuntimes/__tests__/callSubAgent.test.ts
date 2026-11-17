import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';
import { runCallSubAgent } from '../callSubAgent';

const { mockGetAgentConfigById, mockListBackgroundSubAgentCalls, mockThreadFindById } = vi.hoisted(
  () => ({
    mockGetAgentConfigById: vi.fn(),
    mockListBackgroundSubAgentCalls: vi.fn(),
    mockThreadFindById: vi.fn(),
  }),
);

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

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn(function () {
    return { listBackgroundSubAgentCalls: mockListBackgroundSubAgentCalls };
  }),
}));

const scope = { agentId: 'agent-caller', db: {} as never, topicId: 'topic-1', userId: 'user-1' };

const started = (overrides: Record<string, unknown> = {}) =>
  vi.fn().mockResolvedValue({
    started: true,
    subOperationId: 'op-child',
    threadId: 'thread-child',
    toolMessageId: 'tool-msg',
    ...overrides,
  });

const ctxWith = (run: ReturnType<typeof vi.fn>, extra: Partial<ToolExecutionContext> = {}) =>
  ({ subAgent: { run }, toolManifestMap: {}, ...extra }) as ToolExecutionContext;

describe('runCallSubAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListBackgroundSubAgentCalls.mockResolvedValue([]);
    mockGetAgentConfigById.mockResolvedValue({ title: 'Designer' });
    mockThreadFindById.mockResolvedValue(undefined);
  });

  describe('without agentId (a copy of the caller)', () => {
    it('runs a copy and never reads an agent', async () => {
      const run = started();

      const result = await runCallSubAgent(
        { description: 'Research', instruction: 'Find it' },
        ctxWith(run),
        scope,
      );

      expect(run).toHaveBeenCalledWith(
        expect.not.objectContaining({ agentId: expect.anything(), canSteer: false }),
      );
      expect(mockGetAgentConfigById).not.toHaveBeenCalled();
      expect(result).toMatchObject({ deferred: true, state: { status: 'pending' } });
      expect(result.state).not.toHaveProperty('targetAgentId');
    });

    it('treats the caller naming itself as a copy', async () => {
      const run = started();

      await runCallSubAgent(
        { agentId: 'agent-caller', description: 'Research', instruction: 'Find it' },
        ctxWith(run),
        scope,
      );

      expect(run.mock.calls[0][0]).not.toHaveProperty('agentId');
    });
  });

  describe('with agentId (another agent)', () => {
    it('runs the target, answering as itself', async () => {
      const run = started();

      const result = await runCallSubAgent(
        { agentId: ' agent-designer ', description: 'Logo', instruction: 'Draft a logo' },
        ctxWith(run),
        scope,
      );

      expect(mockGetAgentConfigById).toHaveBeenCalledWith('agent-designer');
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-designer',
          description: 'Logo',
          senderName: 'Designer',
        }),
      );
      expect(result).toMatchObject({
        deferred: true,
        state: { targetAgentId: 'agent-designer', threadId: 'thread-child' },
      });
    });

    it('labels the call with the target title when no description is given', async () => {
      const run = started();

      await runCallSubAgent(
        { agentId: 'agent-designer', description: '', instruction: 'Draft a logo' },
        ctxWith(run),
        scope,
      );

      expect(run).toHaveBeenCalledWith(expect.objectContaining({ description: 'Designer' }));
    });

    it('refuses an agent the user cannot access, without starting anything', async () => {
      mockGetAgentConfigById.mockResolvedValue(null);
      const run = vi.fn();

      const result = await runCallSubAgent(
        { agentId: 'agent-foreign', description: 'x', instruction: 'y' },
        ctxWith(run),
        scope,
      );

      expect(result).toMatchObject({ error: { code: 'AGENT_NOT_FOUND' }, success: false });
      expect(result.content).toContain('not found or you do not have access');
      expect(run).not.toHaveBeenCalled();
    });

    it('rejects a non-string agentId', async () => {
      const run = vi.fn();

      const result = await runCallSubAgent(
        { agentId: 42 as never, description: 'x', instruction: 'y' },
        ctxWith(run),
        scope,
      );

      expect(result).toMatchObject({ error: { code: 'INVALID_ARGUMENTS' } });
      expect(run).not.toHaveBeenCalled();
    });

    // An external agent's process never reads the steer queue.
    it('marks an external (Claude Code) target as not steerable', async () => {
      mockGetAgentConfigById.mockResolvedValue({
        agencyConfig: { heterogeneousProvider: { type: 'claude-code' } },
        title: 'Claude Code',
      });
      const run = started();

      await runCallSubAgent(
        { agentId: 'agent-cc', description: 'Fix', instruction: 'Fix the bug' },
        ctxWith(run),
        scope,
      );

      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-cc', canSteer: false }),
      );
    });

    it('starts it in the background with a follow-up handle', async () => {
      const run = started();

      const result = await runCallSubAgent(
        {
          agentId: 'agent-designer',
          description: 'Logo',
          instruction: 'Draft a logo',
          runInBackground: true,
        },
        ctxWith(run),
        scope,
      );

      expect(run).toHaveBeenCalledWith(expect.objectContaining({ background: true }));
      expect(result.deferred).toBeUndefined();
      expect(result.content).toContain('<sub_agent id="thread-child" />');
    });

    it('names the target when it fails to start', async () => {
      const run = vi.fn().mockResolvedValue({ error: 'offline', started: false, threadId: '' });

      const result = await runCallSubAgent(
        { agentId: 'agent-designer', description: 'Logo', instruction: 'Draft a logo' },
        ctxWith(run),
        scope,
      );

      expect(result.content).toBe('Agent "Designer" failed to start: offline');
    });
  });

  describe('continuing with subAgentId', () => {
    it('keeps the agent a sub-agent was started with', async () => {
      mockThreadFindById.mockResolvedValue({ agentId: 'agent-designer', id: 'thread-1' });
      const run = started({ threadId: 'thread-1' });

      await runCallSubAgent(
        { description: 'More', instruction: 'Another option', subAgentId: 'thread-1' },
        ctxWith(run),
        scope,
      );

      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-designer', subAgentId: 'thread-1' }),
      );
    });

    it('continues a copy without naming an agent', async () => {
      mockThreadFindById.mockResolvedValue({ agentId: 'agent-caller', id: 'thread-1' });
      const run = started({ threadId: 'thread-1' });

      await runCallSubAgent(
        { description: 'More', instruction: 'Go on', subAgentId: 'thread-1' },
        ctxWith(run),
        scope,
      );

      expect(run.mock.calls[0][0]).not.toHaveProperty('agentId');
      expect(mockGetAgentConfigById).not.toHaveBeenCalled();
    });

    it('refuses to switch a sub-agent to another agent', async () => {
      mockThreadFindById.mockResolvedValue({ agentId: 'agent-designer', id: 'thread-1' });
      const run = vi.fn();

      const result = await runCallSubAgent(
        {
          agentId: 'agent-writer',
          description: 'More',
          instruction: 'Go on',
          subAgentId: 'thread-1',
        },
        ctxWith(run),
        scope,
      );

      expect(result).toMatchObject({ error: { code: 'INVALID_ARGUMENTS' }, success: false });
      expect(result.content).toContain('runs as agent "agent-designer"');
      expect(run).not.toHaveBeenCalled();
    });
  });
});

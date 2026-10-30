import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolExecutionContext } from '../../types';

const mockListBackgroundSubAgentCalls = vi.hoisted(() => vi.fn());

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(function () {
    return {
      listBackgroundSubAgentCalls: (...args: any[]) => mockListBackgroundSubAgentCalls(...args),
    };
  }),
}));

const { lobeAgentRuntime } = await import('../lobeAgent');
const { MAX_RUNNING_BACKGROUND_SUB_AGENTS } = await import('../backgroundSubAgent');

describe('lobeAgentRuntime callSubAgent', () => {
  const baseContext: ToolExecutionContext = {
    messageId: 'msg-1',
    serverDB: {} as any,
    toolManifestMap: {},
    userId: 'user-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockListBackgroundSubAgentCalls.mockResolvedValue([]);
  });

  describe('runInBackground', () => {
    const topicContext = { ...baseContext, topicId: 'topic-1' } as ToolExecutionContext;

    it('returns the start receipt at once, written into the runner placeholder', async () => {
      const runtime = lobeAgentRuntime.factory(topicContext);
      const run = vi.fn().mockResolvedValue({
        started: true,
        subOperationId: 'sub-op-1',
        threadId: 'thread-1',
        toolMessageId: 'placeholder-1',
      });

      const result = await runtime.callSubAgent(
        { description: 'Research', instruction: 'Find the answer', runInBackground: true },
        { ...topicContext, subAgent: { run } } as ToolExecutionContext,
      );

      expect(run).toHaveBeenCalledWith(expect.objectContaining({ background: true }));
      expect(result.deferred).toBeUndefined();
      expect(result).toMatchObject({ success: true, toolMessageId: 'placeholder-1' });
      expect(result.content).toContain('Started in the background');
      expect(result.content).toMatch(/<sub_agent id="thread-1" \/>$/);
    });

    it('refuses in a group conversation without starting anything', async () => {
      const groupContext = { ...topicContext, groupId: 'group-1' } as ToolExecutionContext;
      const runtime = lobeAgentRuntime.factory(groupContext);
      const run = vi.fn();

      const result = await runtime.callSubAgent(
        { description: 'Research', instruction: 'Find the answer', runInBackground: true },
        { ...groupContext, subAgent: { run } } as ToolExecutionContext,
      );

      expect(result).toMatchObject({
        error: { code: 'BACKGROUND_SUB_AGENT_UNSUPPORTED' },
        success: false,
      });
      expect(run).not.toHaveBeenCalled();
    });

    it('refuses once the conversation already runs the maximum', async () => {
      mockListBackgroundSubAgentCalls.mockResolvedValue(
        Array.from({ length: MAX_RUNNING_BACKGROUND_SUB_AGENTS }, (_, index) => ({
          id: `running-${index}`,
        })),
      );
      const runtime = lobeAgentRuntime.factory(topicContext);
      const run = vi.fn();

      const result = await runtime.callSubAgent(
        { description: 'Research', instruction: 'Find the answer', runInBackground: true },
        { ...topicContext, subAgent: { run } } as ToolExecutionContext,
      );

      expect(mockListBackgroundSubAgentCalls).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'running', topicId: 'topic-1' }),
      );
      expect(result).toMatchObject({ error: { code: 'BACKGROUND_SUB_AGENT_LIMIT' } });
      expect(run).not.toHaveBeenCalled();
    });

    it('still reports a start failure inline', async () => {
      const runtime = lobeAgentRuntime.factory(topicContext);
      const run = vi.fn().mockResolvedValue({ error: 'boom', started: false, threadId: '' });

      const result = await runtime.callSubAgent(
        { description: 'Research', instruction: 'Find the answer', runInBackground: true },
        { ...topicContext, subAgent: { run } } as ToolExecutionContext,
      );

      expect(result).toMatchObject({ error: { code: 'SUB_AGENT_START_FAILED' }, success: false });
      expect(result.toolMessageId).toBeUndefined();
    });
  });
});

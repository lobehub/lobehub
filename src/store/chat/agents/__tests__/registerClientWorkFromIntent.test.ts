import type { AgentState } from '@lobechat/agent-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteTaskWork: vi.fn(),
  handleSkillToolResult: vi.fn(),
  refreshConversation: vi.fn(),
  registerDocument: vi.fn(),
  registerTask: vi.fn(),
}));

vi.mock('@/services/work', () => ({
  workService: {
    deleteTaskWork: mocks.deleteTaskWork,
    handleSkillToolResult: mocks.handleSkillToolResult,
    refreshConversation: mocks.refreshConversation,
    registerDocument: mocks.registerDocument,
    registerTask: mocks.registerTask,
  },
}));

const { registerClientWorkFromIntent } = await import('../registerClientWorkFromIntent');

const state: Pick<AgentState, 'cost' | 'usage'> = {
  cost: {
    calculatedAt: '2026-06-30T08:00:00.000Z',
    currency: 'USD',
    llm: { byModel: [], currency: 'USD', total: 0.01 },
    tools: { byTool: [], currency: 'USD', total: 0.001 },
    total: 0.011,
  },
  usage: {
    llm: {} as any,
    tools: { byTool: [], totalCalls: 1, totalTimeMs: 10 },
  } as any,
};

const base = {
  agentId: 'agent-1',
  rootOperationId: 'op-root',
  sourceMessageId: 'msg-tool-1',
  sourceToolCallId: 'tool-call-1',
  sourceToolIdentifier: 'lobe-task',
  sourceToolName: 'createTask',
  state,
  threadId: 'thread-1',
  topicId: 'topic-1',
};

describe('registerClientWorkFromIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.registerTask.mockResolvedValue({ id: 'work-1' });
    mocks.registerDocument.mockResolvedValue({ id: 'doc-work-1' });
    mocks.deleteTaskWork.mockResolvedValue(undefined);
    mocks.handleSkillToolResult.mockResolvedValue({ id: 'skill-work-1' });
    mocks.refreshConversation.mockResolvedValue(undefined);
  });

  describe('task', () => {
    it('registers each created target with the cumulative cost without refreshing per tool', async () => {
      await registerClientWorkFromIntent({
        ...base,
        intent: {
          action: 'create',
          changeType: 'created',
          targets: [{ taskId: 'task_1', taskIdentifier: 'T-1' }],
          type: 'task',
        },
      });

      expect(mocks.registerTask).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          cumulativeCost: 0.011,
          cumulativeUsage: expect.objectContaining({
            cost: expect.objectContaining({ total: 0.011 }),
          }),
          changeType: 'created',
          messageId: 'msg-tool-1',
          rootOperationId: 'op-root',
          taskId: 'task_1',
          taskIdentifier: 'T-1',
          threadId: 'thread-1',
          toolCallId: 'tool-call-1',
          toolName: 'createTask',
          topicId: 'topic-1',
        }),
      );
      // The runtime settles Work caches once at operation end — no per-tool flood.
      expect(mocks.refreshConversation).not.toHaveBeenCalled();
    });

    it('deletes the task work per target without refreshing the message list', async () => {
      await registerClientWorkFromIntent({
        ...base,
        intent: { action: 'delete', targets: [{ taskId: 'task_1' }], type: 'task' },
      });

      expect(mocks.deleteTaskWork).toHaveBeenCalledWith({ taskId: 'task_1' });
      expect(mocks.registerTask).not.toHaveBeenCalled();
      expect(mocks.refreshConversation).not.toHaveBeenCalled();
    });

    it('is a no-op for a create/update intent without a changeType', async () => {
      await registerClientWorkFromIntent({
        ...base,
        // deliberately malformed: create intent missing changeType
        intent: { action: 'create', targets: [{ taskId: 'task_1' }], type: 'task' },
      });

      expect(mocks.registerTask).not.toHaveBeenCalled();
      expect(mocks.refreshConversation).not.toHaveBeenCalled();
    });

    it('swallows registerTask errors (best-effort, never throws)', async () => {
      mocks.registerTask.mockRejectedValueOnce(new Error('trpc died'));

      await expect(
        registerClientWorkFromIntent({
          ...base,
          intent: {
            action: 'create',
            changeType: 'created',
            targets: [{ taskId: 'task_1' }],
            type: 'task',
          },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('document', () => {
    it('registers a document with the cumulative cost without refreshing per tool', async () => {
      await registerClientWorkFromIntent({
        ...base,
        sourceToolName: 'createDocument',
        intent: {
          action: 'register',
          document: {
            agentId: 'agent-1',
            documentId: 'doc_1',
            changeType: 'created',
            toolName: 'createDocument',
          },
          type: 'document',
        },
      });

      expect(mocks.registerDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          cumulativeCost: 0.011,
          documentId: 'doc_1',
          changeType: 'created',
          rootOperationId: 'op-root',
          toolCallId: 'tool-call-1',
          toolName: 'createDocument',
        }),
      );
      expect(mocks.refreshConversation).not.toHaveBeenCalled();
    });

    it('is a no-op for a document delete intent (deletes stay lambda-side)', async () => {
      await registerClientWorkFromIntent({
        ...base,
        intent: {
          action: 'delete',
          document: { documentId: 'doc_1' },
          type: 'document',
        },
      });

      expect(mocks.registerDocument).not.toHaveBeenCalled();
      expect(mocks.refreshConversation).not.toHaveBeenCalled();
    });
  });

  describe('skill', () => {
    it('forwards the skill payload to handleSkillToolResult with the cumulative cost', async () => {
      await registerClientWorkFromIntent({
        ...base,
        sourceToolName: 'createIssue',
        intent: {
          args: { title: 'x' },
          data: { url: 'https://linear.app/x' },
          provider: 'linear',
          toolName: 'createIssue',
          type: 'skill',
        },
      });

      expect(mocks.handleSkillToolResult).toHaveBeenCalledWith(
        expect.objectContaining({
          args: { title: 'x' },
          cumulativeCost: 0.011,
          data: { url: 'https://linear.app/x' },
          provider: 'linear',
          rootOperationId: 'op-root',
          toolCallId: 'tool-call-1',
          toolName: 'createIssue',
        }),
      );
    });
  });
});

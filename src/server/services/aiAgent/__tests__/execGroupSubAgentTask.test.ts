import { ThreadStatus, ThreadType } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAgentService } from '../index';

// Mock trusted client to avoid server-side env access
vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

// Mock ThreadModel
const mockThreadModel = {
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
};

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => mockThreadModel),
}));

// Mock other models
vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn(),
  })),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
  })),
}));

// Mock AgentRuntimeService
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: vi.fn().mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    }),
  })),
}));

describe('AiAgentService.execSubAgentTask', () => {
  let service: AiAgentService;
  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock implementations
    mockThreadModel.create.mockResolvedValue({
      id: 'thread-123',
      type: ThreadType.Isolation,
      status: ThreadStatus.Active,
      topicId: 'topic-1',
      agentId: 'agent-1',
      groupId: 'group-1',
      sourceMessageId: 'parent-msg-1',
    });
    mockThreadModel.update.mockResolvedValue({});

    service = new AiAgentService(mockDb, userId);
  });

  describe('successful task execution', () => {
    it('should create Thread with correct parameters', async () => {
      // Mock execAgent to return success
      vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      await service.execSubAgentTask({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      expect(mockThreadModel.create).toHaveBeenCalledWith({
        agentId: 'agent-1',
        groupId: 'group-1',
        sourceMessageId: 'parent-msg-1',
        topicId: 'topic-1',
        type: ThreadType.Isolation,
      });
    });

    it('should update Thread status to processing with startedAt', async () => {
      vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      await service.execSubAgentTask({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      expect(mockThreadModel.update).toHaveBeenCalledWith('thread-123', {
        metadata: { startedAt: expect.any(String) },
        status: ThreadStatus.Processing,
      });
    });

    it('should call execAgent with threadId in appContext and stepCallbacks', async () => {
      const execAgentSpy = vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      await service.execSubAgentTask({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      expect(execAgentSpy).toHaveBeenCalledWith({
        agentId: 'agent-1',
        appContext: {
          groupId: 'group-1',
          threadId: 'thread-123',
          topicId: 'topic-1',
        },
        autoStart: true,
        prompt: 'Test instruction',
        stepCallbacks: expect.objectContaining({
          onAfterStep: expect.any(Function),
          onComplete: expect.any(Function),
        }),
      });
    });

    it('should store operationId and startedAt in Thread metadata', async () => {
      vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      await service.execSubAgentTask({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      // Second update call should be storing operationId and startedAt in metadata
      expect(mockThreadModel.update).toHaveBeenCalledWith('thread-123', {
        metadata: { operationId: 'op-123', startedAt: expect.any(String) },
      });
    });

    it('should return correct result on success', async () => {
      vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      const result = await service.execSubAgentTask({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      expect(result).toEqual({
        assistantMessageId: 'assistant-msg-1',
        error: undefined,
        operationId: 'op-123',
        success: true,
        threadId: 'thread-123',
      });
    });
  });

  describe('execAgent failure handling', () => {
    it('should update Thread status to failed when execAgent fails', async () => {
      vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: 'Agent execution failed',
        message: 'Agent operation failed to start',
        operationId: 'op-123',
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      await service.execSubAgentTask({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      // Should update Thread status to failed with metadata
      expect(mockThreadModel.update).toHaveBeenCalledWith('thread-123', {
        metadata: expect.objectContaining({
          completedAt: expect.any(String),
          duration: expect.any(Number),
          error: 'Agent execution failed',
          operationId: 'op-123',
          startedAt: expect.any(String),
        }),
        status: ThreadStatus.Failed,
      });
    });

    it('should store error info with duration in Thread metadata when execAgent fails', async () => {
      vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: 'QStash service unavailable',
        message: 'Agent operation failed to start',
        operationId: 'op-123',
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      await service.execSubAgentTask({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      // Last update call should contain error info, completedAt, startedAt, and duration
      const lastUpdateCall = mockThreadModel.update.mock.calls.find(
        (call) => call[1].status === ThreadStatus.Failed,
      );
      expect(lastUpdateCall).toBeDefined();
      expect(lastUpdateCall![1].metadata).toMatchObject({
        completedAt: expect.any(String),
        duration: expect.any(Number),
        error: 'QStash service unavailable',
        operationId: 'op-123',
        startedAt: expect.any(String),
      });
    });

    it('should return result with error info when execAgent fails', async () => {
      vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: 'Agent execution failed',
        message: 'Agent operation failed to start',
        operationId: 'op-123',
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      const result = await service.execSubAgentTask({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      expect(result).toEqual({
        assistantMessageId: 'assistant-msg-1',
        error: 'Agent execution failed',
        operationId: 'op-123',
        success: false,
        threadId: 'thread-123',
      });
    });
  });

  describe('Thread creation failure', () => {
    it('should throw error when Thread creation fails', async () => {
      mockThreadModel.create.mockResolvedValue(null);

      await expect(
        service.execSubAgentTask({
          agentId: 'agent-1',
          groupId: 'group-1',
          instruction: 'Test instruction',
          parentMessageId: 'parent-msg-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow('Failed to create thread for task execution');
    });

    it('should throw error when Thread creation throws', async () => {
      mockThreadModel.create.mockRejectedValue(new Error('Database connection failed'));

      await expect(
        service.execSubAgentTask({
          agentId: 'agent-1',
          groupId: 'group-1',
          instruction: 'Test instruction',
          parentMessageId: 'parent-msg-1',
          topicId: 'topic-1',
        }),
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('task message summary update', () => {
    it('should pass sourceMessageId (parentMessageId) to callbacks for summary update', async () => {
      const execAgentSpy = vi.spyOn(service, 'execAgent').mockResolvedValue({
        agentId: 'agent-1',
        assistantMessageId: 'assistant-msg-1',
        autoStarted: true,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: 'queue-msg-1',
        operationId: 'op-123',
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        topicId: 'topic-1',
        userMessageId: 'user-msg-1',
      });

      await service.execSubAgentTask({
        agentId: 'agent-1',
        groupId: 'group-1',
        instruction: 'Test instruction',
        parentMessageId: 'parent-msg-1',
        topicId: 'topic-1',
      });

      // Verify that stepCallbacks was passed with onComplete
      expect(execAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          stepCallbacks: expect.objectContaining({
            onComplete: expect.any(Function),
          }),
        }),
      );

      // Get the onComplete callback
      const callArgs = execAgentSpy.mock.calls[0][0];
      const onComplete = callArgs.stepCallbacks?.onComplete;

      expect(onComplete).toBeDefined();
    });
  });
});

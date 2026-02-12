import { type AgentRuntimeContext } from '@lobechat/agent-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InMemoryAgentStateManager,
  InMemoryStreamEventManager,
} from '@/server/modules/AgentRuntime';

import { AgentRuntimeService } from '../AgentRuntimeService';

// Mock database models
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

// Mock ModelRuntime
vi.mock('@/server/modules/ModelRuntime', () => ({
  initializeRuntimeOptions: vi.fn(),
  initModelRuntimeFromDB: vi.fn().mockResolvedValue({
    chat: vi.fn(),
  }),
  ApiKeyManager: vi.fn().mockImplementation(() => ({
    getApiKey: vi.fn(),
    getAllApiKeys: vi.fn(),
  })),
}));

// Mock search service
vi.mock('@/server/services/search', () => ({
  searchService: {
    search: vi.fn(),
  },
}));

// Mock plugin gateway service
vi.mock('@/server/services/pluginGateway', () => ({
  PluginGatewayService: vi.fn().mockImplementation(() => ({
    getPluginManifest: vi.fn(),
    executePlugin: vi.fn(),
  })),
}));

// Mock MCP service
vi.mock('@/server/services/mcp', () => ({
  mcpService: {
    executeCommand: vi.fn(),
  },
}));

// Mock tool execution service
vi.mock('@/server/services/toolExecution', () => ({
  ToolExecutionService: vi.fn().mockImplementation(() => ({
    executeToolCall: vi.fn().mockResolvedValue({ result: 'success' }),
  })),
}));

vi.mock('@/server/services/toolExecution/builtin', () => ({
  BuiltinToolsExecutor: vi.fn().mockImplementation(() => ({
    execute: vi.fn(),
  })),
}));

describe('AgentRuntimeService.executeSync', () => {
  let service: AgentRuntimeService;
  let stateManager: InMemoryAgentStateManager;
  let streamEventManager: InMemoryStreamEventManager;

  const mockDb = {} as any;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();

    // Create in-memory managers
    stateManager = new InMemoryAgentStateManager();
    streamEventManager = new InMemoryStreamEventManager();

    // Create service with in-memory implementations and no queue
    service = new AgentRuntimeService(mockDb, userId, {
      coordinatorOptions: {
        stateManager,
        streamEventManager,
      },
      queueService: null, // Disable queue for sync execution
      streamEventManager,
    });
  });

  describe('createOperation with queueService disabled', () => {
    it('should create operation without scheduling queue message', async () => {
      const operationId = 'test-op-1';
      const initialContext: AgentRuntimeContext = {
        payload: { message: [{ content: 'Hello' }] },
        phase: 'user_input',
        session: {
          messageCount: 1,
          sessionId: operationId,
          status: 'idle',
          stepCount: 0,
        },
      };

      const result = await service.createOperation({
        agentConfig: { model: 'gpt-4o', provider: 'openai' },
        appContext: { agentId: 'test-agent' },
        autoStart: true, // Would normally trigger queue, but queue is disabled
        initialContext,
        initialMessages: [{ role: 'user', content: 'Hello' }],
        modelRuntimeConfig: { model: 'gpt-4o', provider: 'openai' },
        operationId,
        toolManifestMap: {},
        tools: [],
        userId,
      });

      expect(result.success).toBe(true);
      expect(result.operationId).toBe(operationId);
      // autoStarted should be false because queue is disabled
      expect(result.autoStarted).toBe(false);
      expect(result.messageId).toBeUndefined();

      // State should be saved
      const state = await stateManager.loadAgentState(operationId);
      expect(state).not.toBeNull();
      expect(state?.operationId).toBe(operationId);
    });

    it('should save initial state correctly', async () => {
      const operationId = 'test-op-2';
      const initialContext: AgentRuntimeContext = {
        payload: {},
        phase: 'user_input',
        session: {
          messageCount: 2,
          sessionId: operationId,
          status: 'idle',
          stepCount: 0,
        },
      };

      await service.createOperation({
        agentConfig: { systemRole: 'You are a helpful assistant' },
        appContext: { agentId: 'test-agent', topicId: 'topic-1' },
        autoStart: false,
        initialContext,
        initialMessages: [
          { role: 'system', content: 'You are a helpful assistant' },
          { role: 'user', content: 'Hello' },
        ],
        modelRuntimeConfig: { model: 'gpt-4o', provider: 'openai' },
        operationId,
        toolManifestMap: {},
        tools: [],
        userId,
      });

      const state = await stateManager.loadAgentState(operationId);
      expect(state).not.toBeNull();
      expect(state?.messages).toHaveLength(2);
      expect(state?.metadata?.agentId).toBe('test-agent');
      expect(state?.metadata?.topicId).toBe('topic-1');
    });
  });

  describe('getCoordinator', () => {
    it('should return the coordinator instance', () => {
      const coordinator = service.getCoordinator();
      expect(coordinator).toBeDefined();
    });
  });

  describe('InMemoryAgentStateManager', () => {
    it('should save and load state correctly', async () => {
      const operationId = 'state-test-1';
      const state = {
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        messages: [{ role: 'user', content: 'Hello' }],
        operationId,
        status: 'idle' as const,
        stepCount: 0,
      };

      await stateManager.createOperationMetadata(operationId, { userId });
      await stateManager.saveAgentState(operationId, state as any);

      const loaded = await stateManager.loadAgentState(operationId);
      expect(loaded).toEqual(state);
    });

    it('should return null for non-existent operation', async () => {
      const loaded = await stateManager.loadAgentState('non-existent');
      expect(loaded).toBeNull();
    });

    it('should track active operations', async () => {
      await stateManager.saveAgentState('op-1', { status: 'idle' } as any);
      await stateManager.saveAgentState('op-2', { status: 'running' } as any);

      const activeOps = await stateManager.getActiveOperations();
      expect(activeOps).toContain('op-1');
      expect(activeOps).toContain('op-2');
      expect(activeOps).toHaveLength(2);
    });

    it('should delete operation correctly', async () => {
      const operationId = 'delete-test';
      await stateManager.createOperationMetadata(operationId, {});
      await stateManager.saveAgentState(operationId, { status: 'idle' } as any);

      await stateManager.deleteAgentOperation(operationId);

      const loaded = await stateManager.loadAgentState(operationId);
      expect(loaded).toBeNull();

      const metadata = await stateManager.getOperationMetadata(operationId);
      expect(metadata).toBeNull();
    });

    it('should clear all data', () => {
      stateManager.clear();
      // After clear, getActiveOperations should return empty array
      expect(stateManager.getActiveOperations()).resolves.toEqual([]);
    });
  });

  describe('InMemoryStreamEventManager', () => {
    it('should publish and retrieve events', async () => {
      const operationId = 'stream-test-1';

      await streamEventManager.publishAgentRuntimeInit(operationId, { status: 'idle' });
      await streamEventManager.publishStreamChunk(operationId, 0, {
        chunkType: 'text',
        content: 'Hello',
      });

      const events = await streamEventManager.getStreamHistory(operationId);
      expect(events).toHaveLength(2);
    });

    it('should support event subscription', async () => {
      const operationId = 'subscribe-test';
      const receivedEvents: any[] = [];

      const unsubscribe = streamEventManager.subscribe(operationId, (events) => {
        receivedEvents.push(...events);
      });

      await streamEventManager.publishStreamChunk(operationId, 0, {
        chunkType: 'text',
        content: 'Test',
      });

      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe('stream_chunk');

      unsubscribe();
    });

    it('should wait for specific event type', async () => {
      const operationId = 'wait-test';

      // Publish event after a small delay
      setTimeout(async () => {
        await streamEventManager.publishAgentRuntimeEnd(operationId, 1, { status: 'done' });
      }, 10);

      const event = await streamEventManager.waitForEvent(operationId, 'agent_runtime_end', 1000);

      expect(event.type).toBe('agent_runtime_end');
    });

    it('should clear all data', () => {
      streamEventManager.clear();
      // getAllEvents should return empty after clear
      expect(streamEventManager.getAllEvents('any')).toEqual([]);
    });
  });
});

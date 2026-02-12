/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntimeService } from './AgentRuntimeService';
import {
  type AgentExecutionParams,
  type OperationCreationParams,
  type StartExecutionParams,
} from './types';

// Mock trusted client to avoid server-side env access
vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

// Mock database and models
vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfigById: vi.fn(),
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

// Mock ModelRuntime to avoid server-side env access
vi.mock('@/server/modules/ModelRuntime', () => ({
  initializeRuntimeOptions: vi.fn(),
  ApiKeyManager: vi.fn().mockImplementation(() => ({
    getApiKey: vi.fn(),
    getAllApiKeys: vi.fn(),
  })),
}));

// Mock search service to avoid server-side env access
vi.mock('@/server/services/search', () => ({
  SearchService: vi.fn().mockImplementation(() => ({
    search: vi.fn(),
  })),
  searchService: {
    search: vi.fn(),
  },
}));

// Mock plugin gateway service to avoid server-side env access
vi.mock('@/server/services/pluginGateway', () => ({
  PluginGatewayService: vi.fn().mockImplementation(() => ({
    getPluginManifest: vi.fn(),
    executePlugin: vi.fn(),
  })),
}));

// Mock dependencies
vi.mock('@/server/modules/AgentRuntime', () => ({
  AgentRuntimeCoordinator: vi.fn().mockImplementation(() => ({
    createAgentOperation: vi.fn(),
    deleteAgentOperation: vi.fn(),
    disconnect: vi.fn(),
    getActiveOperations: vi.fn(),
    getExecutionHistory: vi.fn(),
    getOperationMetadata: vi.fn(),
    loadAgentState: vi.fn(),
    saveAgentState: vi.fn(),
    saveStepResult: vi.fn(),
  })),
  createStreamEventManager: vi.fn().mockReturnValue({
    getStreamHistory: vi.fn().mockResolvedValue([]),
    publishStreamEvent: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  }),
  createStreamingFinishExecutor: vi.fn(),
  createStreamingHumanApprovalExecutor: vi.fn(),
  createStreamingLLMExecutor: vi.fn(),
  createStreamingToolExecutor: vi.fn(),
  DurableLobeChatAgent: vi.fn(),
  StreamEventManager: vi.fn().mockImplementation(() => ({
    getStreamHistory: vi.fn(),
    publishStreamEvent: vi.fn(),
  })),
}));

vi.mock('@lobechat/agent-runtime', () => ({
  AgentRuntime: vi.fn().mockImplementation((agent, options) => ({
    step: vi.fn(),
  })),
}));

vi.mock('@/server/services/queue', () => ({
  QueueService: vi.fn().mockImplementation(() => ({
    getImpl: vi.fn().mockReturnValue(null),
    scheduleMessage: vi.fn(),
  })),
}));

// Mock Mecha module
vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({
      tools: [],
      enabledToolIds: [],
      filteredTools: [],
    }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  serverMessagesEngine: vi.fn().mockResolvedValue([]),
}));

// Mock model-bank
vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof import('model-bank')>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        id: 'gpt-4o-mini',
        providerId: 'openai',
        abilities: {
          functionCall: true,
          vision: true,
          video: false,
        },
      },
    ],
  };
});

describe('AgentRuntimeService', () => {
  let service: AgentRuntimeService;
  let mockCoordinator: any;
  let mockStreamManager: any;
  let mockQueueService: any;
  let mockDb: any;
  const mockUserId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_RUNTIME_BASE_URL = 'http://localhost:3010';

    // Mock database
    mockDb = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    service = new AgentRuntimeService(mockDb, mockUserId);

    // Get mocked instances
    mockCoordinator = (service as any).coordinator;
    mockStreamManager = (service as any).streamManager;
    mockQueueService = (service as any).queueService;
  });

  afterEach(() => {
    delete process.env.AGENT_RUNTIME_BASE_URL;
  });

  describe('constructor', () => {
    it('should initialize with default base URL', () => {
      delete process.env.AGENT_RUNTIME_BASE_URL;
      const newService = new AgentRuntimeService(mockDb, mockUserId);
      expect((newService as any).baseURL).toBe('http://localhost:3210/api/agent');
    });

    it('should initialize with custom base URL from environment', () => {
      process.env.AGENT_RUNTIME_BASE_URL = 'http://custom:3000';
      const newService = new AgentRuntimeService(mockDb, mockUserId);
      expect((newService as any).baseURL).toBe('http://custom:3000/api/agent');
    });
  });

  describe('createOperation', () => {
    const mockParams: OperationCreationParams = {
      operationId: 'test-operation-1',
      initialContext: {
        phase: 'user_input',
        payload: {
          message: { content: 'test' },
          sessionId: 'test-operation-1',
          isFirstMessage: true,
        },
        session: { sessionId: 'test-operation-1', status: 'idle', stepCount: 0, messageCount: 0 },
      },
      appContext: {},
      agentConfig: { name: 'test-agent' },
      modelRuntimeConfig: { model: 'gpt-4' },
      toolManifestMap: {},
      userId: 'user-123',
      autoStart: true,
      initialMessages: [],
    };

    it('should create operation successfully with autoStart=true', async () => {
      mockQueueService.scheduleMessage.mockResolvedValueOnce('message-123');

      const result = await service.createOperation(mockParams);

      expect(result).toEqual({
        success: true,
        operationId: 'test-operation-1',
        autoStarted: true,
        messageId: 'message-123',
      });

      expect(mockCoordinator.saveAgentState).toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({
          operationId: 'test-operation-1',
          status: 'idle',
          stepCount: 0,
          messages: [],
          metadata: {
            agentConfig: mockParams.agentConfig,
            modelRuntimeConfig: mockParams.modelRuntimeConfig,
            userId: mockParams.userId,
          },
          toolManifestMap: {},
        }),
      );

      expect(mockCoordinator.createAgentOperation).toHaveBeenCalledWith('test-operation-1', {
        agentConfig: mockParams.agentConfig,
        modelRuntimeConfig: mockParams.modelRuntimeConfig,
        userId: mockParams.userId,
      });

      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith({
        operationId: 'test-operation-1',
        stepIndex: 0,
        context: mockParams.initialContext,
        endpoint: 'http://localhost:3010/api/agent/run',
        priority: 'high',
        delay: 50,
      });
    });

    it('should create operation successfully with autoStart=false', async () => {
      const params = { ...mockParams, autoStart: false };

      const result = await service.createOperation(params);

      expect(result).toEqual({
        success: true,
        operationId: 'test-operation-1',
        autoStarted: false,
        messageId: undefined,
      });

      expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
    });

    it('should handle errors during operation creation', async () => {
      mockCoordinator.saveAgentState.mockRejectedValueOnce(new Error('Database error'));

      await expect(service.createOperation(mockParams)).rejects.toThrow('Database error');
    });
  });

  describe('executeStep', () => {
    const mockParams: AgentExecutionParams = {
      operationId: 'test-operation-1',
      stepIndex: 1,
      context: {
        phase: 'user_input',
        payload: {
          message: { content: 'test' },
          sessionId: 'test-operation-1',
          isFirstMessage: false,
        },
        session: {
          sessionId: 'test-operation-1',
          status: 'running',
          stepCount: 1,
          messageCount: 1,
        },
      },
    };

    const mockState = {
      operationId: 'test-operation-1',
      status: 'running',
      stepCount: 1,
      messages: [],
      events: [],
      lastModified: new Date().toISOString(),
    };

    const mockMetadata = {
      userId: 'user-123',
      agentConfig: { name: 'test-agent' },
      modelRuntimeConfig: { model: 'gpt-4' },
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      status: 'running',
      totalCost: 0,
      totalSteps: 1,
    };

    beforeEach(() => {
      mockCoordinator.loadAgentState.mockResolvedValue(mockState);
      mockCoordinator.getOperationMetadata.mockResolvedValue(mockMetadata);
    });

    it('should execute step successfully', async () => {
      const mockStepResult = {
        newState: { ...mockState, stepCount: 2, status: 'running' },
        nextContext: mockParams.context,
        events: [],
      };

      // Mock runtime.step
      const mockRuntime = { step: vi.fn().mockResolvedValue(mockStepResult) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      const result = await service.executeStep(mockParams);

      expect(result).toEqual({
        success: true,
        state: mockStepResult.newState,
        stepResult: expect.objectContaining(mockStepResult),
        nextStepScheduled: true,
      });

      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith('test-operation-1', {
        type: 'step_start',
        stepIndex: 1,
        data: {},
      });

      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith('test-operation-1', {
        type: 'step_complete',
        stepIndex: 1,
        data: {
          stepIndex: 1,
          finalState: mockStepResult.newState,
          nextStepScheduled: false, // Published before nextStepScheduled is updated
        },
      });

      expect(mockCoordinator.saveStepResult).toHaveBeenCalled();
      expect(mockQueueService.scheduleMessage).toHaveBeenCalled();
    });

    it('should handle missing agent state', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue(null);

      await expect(service.executeStep(mockParams)).rejects.toThrow(
        'Agent state not found for operation test-operation-1',
      );
    });

    it('should handle execution errors', async () => {
      const error = new Error('Runtime error');
      const mockRuntime = { step: vi.fn().mockRejectedValue(error) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      await expect(service.executeStep(mockParams)).rejects.toThrow('Runtime error');

      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith('test-operation-1', {
        type: 'error',
        stepIndex: 1,
        data: {
          stepIndex: 1,
          phase: 'step_execution',
          error: 'Runtime error',
        },
      });
    });

    it('should call onComplete with error in finalState when execution fails', async () => {
      const error = new Error('Runtime error');
      const mockRuntime = { step: vi.fn().mockRejectedValue(error) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      // Register onComplete callback
      const mockOnComplete = vi.fn();
      service.registerStepCallbacks('test-operation-1', {
        onComplete: mockOnComplete,
      });

      await expect(service.executeStep(mockParams)).rejects.toThrow('Runtime error');

      // Verify onComplete is called with error in finalState as ChatMessageError
      // ChatErrorType.InternalServerError = 500
      expect(mockOnComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: 'test-operation-1',
          reason: 'error',
          finalState: expect.objectContaining({
            error: expect.objectContaining({
              type: 500, // ChatErrorType.InternalServerError
              message: 'Runtime error',
              body: expect.objectContaining({ name: 'Error' }),
            }),
          }),
        }),
      );
    });

    it('should call onComplete with ChatCompletionErrorPayload in finalState', async () => {
      // Simulate LLM error format: { errorType: 'InvalidProviderAPIKey', error: { ... } }
      const llmError = {
        errorType: 'InvalidProviderAPIKey',
        error: { status: 401 },
        provider: 'openai',
      };
      const mockRuntime = { step: vi.fn().mockRejectedValue(llmError) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      // Register onComplete callback
      const mockOnComplete = vi.fn();
      service.registerStepCallbacks('test-operation-1', {
        onComplete: mockOnComplete,
      });

      await expect(service.executeStep(mockParams)).rejects.toEqual(llmError);

      // Verify error is formatted correctly with type from errorType
      expect(mockOnComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: 'test-operation-1',
          reason: 'error',
          finalState: expect.objectContaining({
            error: expect.objectContaining({
              type: 'InvalidProviderAPIKey',
              message: 'InvalidProviderAPIKey',
              body: expect.objectContaining({ status: 401 }),
            }),
          }),
        }),
      );
    });

    it('should save error state to coordinator for later retrieval (inMemory mode fix)', async () => {
      const error = new Error('Test error for inMemory mode');
      const mockRuntime = { step: vi.fn().mockRejectedValue(error) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      // Spy on coordinator.saveAgentState to verify it's called with error state
      const saveStateSpy = vi.spyOn((service as any).coordinator, 'saveAgentState');

      await expect(service.executeStep(mockParams)).rejects.toThrow('Test error for inMemory mode');

      // Verify saveAgentState is called with error state before onComplete
      expect(saveStateSpy).toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({
          error: expect.objectContaining({
            type: 500, // ChatErrorType.InternalServerError
            message: 'Test error for inMemory mode',
          }),
          status: 'error',
        }),
      );
    });

    it('should handle human intervention', async () => {
      const paramsWithIntervention = {
        ...mockParams,
        humanInput: { type: 'text', content: 'user input' },
        approvedToolCall: { toolName: 'calculator', args: {} },
        rejectionReason: 'Not safe',
      };

      const mockStepResult = {
        newState: { ...mockState, stepCount: 2, status: 'done' },
        nextContext: null,
        events: [],
      };

      const mockRuntime = { step: vi.fn().mockResolvedValue(mockStepResult) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });
      vi.spyOn(service as any, 'handleHumanIntervention').mockResolvedValue({
        newState: mockState,
        nextContext: mockParams.context,
      });

      const result = await service.executeStep(paramsWithIntervention);

      expect((service as any).handleHumanIntervention).toHaveBeenCalledWith(
        mockRuntime,
        mockState,
        {
          humanInput: paramsWithIntervention.humanInput,
          approvedToolCall: paramsWithIntervention.approvedToolCall,
          rejectionReason: paramsWithIntervention.rejectionReason,
        },
      );

      expect(result.success).toBe(true);
      expect(result.nextStepScheduled).toBe(false); // Should not schedule next step when status is 'done'
    });
  });

  describe('getOperationStatus', () => {
    const mockState = {
      operationId: 'test-operation-1',
      status: 'running',
      stepCount: 5,
      messages: [{ content: 'msg1' }, { content: 'msg2' }],
      cost: { total: 0.1 },
      usage: { tokens: 100 },
      lastModified: new Date().toISOString(),
    };

    const mockMetadata = {
      userId: 'user-123',
      createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      lastActiveAt: new Date(Date.now() - 1800000).toISOString(), // 30 minutes ago
    };

    beforeEach(() => {
      mockCoordinator.loadAgentState.mockResolvedValue(mockState);
      mockCoordinator.getOperationMetadata.mockResolvedValue(mockMetadata);
    });

    it('should get operation status successfully', async () => {
      const result = await service.getOperationStatus({
        operationId: 'test-operation-1',
        includeHistory: false,
      });

      expect(result).toEqual({
        operationId: 'test-operation-1',
        currentState: expect.objectContaining({
          status: 'running',
          stepCount: 5,
          cost: { total: 0.1 },
          usage: { tokens: 100 },
        }),
        metadata: mockMetadata,
        isActive: true,
        isCompleted: false,
        hasError: false,
        needsHumanInput: false,
        stats: {
          totalSteps: 5,
          totalMessages: 2,
          totalCost: 0.1,
          uptime: expect.any(Number),
          lastActiveTime: expect.any(Number),
        },
      });
    });

    it('should include history when requested', async () => {
      const mockHistory = [{ stepIndex: 1, timestamp: Date.now() }];
      const mockEvents = [{ type: 'step_start', timestamp: Date.now() }];

      mockCoordinator.getExecutionHistory.mockResolvedValue(mockHistory);
      mockStreamManager.getStreamHistory.mockResolvedValue(mockEvents);

      const result = await service.getOperationStatus({
        operationId: 'test-operation-1',
        includeHistory: true,
        historyLimit: 20,
      });

      expect(result?.executionHistory).toEqual(mockHistory);
      expect(result?.recentEvents).toEqual(mockEvents.slice(0, 10));
    });

    it('should return null for missing operation', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue(null);
      mockCoordinator.getOperationMetadata.mockResolvedValue(null);

      const result = await service.getOperationStatus({
        operationId: 'nonexistent-operation',
      });

      expect(result).toBeNull();
    });

    it('should handle different operation statuses', async () => {
      // Test waiting_for_human status
      const waitingState = { ...mockState, status: 'waiting_for_human' };
      mockCoordinator.loadAgentState.mockResolvedValue(waitingState);

      const result = await service.getOperationStatus({
        operationId: 'test-operation-1',
      });

      expect(result?.isActive).toBe(true);
      expect(result?.needsHumanInput).toBe(true);
    });
  });

  describe('getPendingInterventions', () => {
    it('should get pending interventions for specific operation', async () => {
      const mockState = {
        status: 'waiting_for_human',
        pendingToolsCalling: [{ toolName: 'calculator', args: {} }],
        stepCount: 3,
        lastModified: new Date().toISOString(),
      };

      const mockMetadata = {
        userId: 'user-123',
        modelRuntimeConfig: { model: 'gpt-4' },
      };

      mockCoordinator.loadAgentState.mockResolvedValue(mockState);
      mockCoordinator.getOperationMetadata.mockResolvedValue(mockMetadata);

      const result = await service.getPendingInterventions({
        operationId: 'test-operation-1',
      });

      expect(result).toEqual({
        totalCount: 1,
        timestamp: expect.any(String),
        pendingInterventions: [
          {
            operationId: 'test-operation-1',
            type: 'tool_approval',
            status: 'waiting_for_human',
            stepCount: 3,
            lastModified: mockState.lastModified,
            userId: 'user-123',
            modelRuntimeConfig: { model: 'gpt-4' },
            pendingToolsCalling: mockState.pendingToolsCalling,
          },
        ],
      });
    });

    it('should get pending interventions for user', async () => {
      const mockOperations = ['operation-1', 'operation-2'];
      mockCoordinator.getActiveOperations.mockResolvedValue(mockOperations);

      // Mock metadata for filtering by userId
      mockCoordinator.getOperationMetadata
        .mockResolvedValueOnce({ userId: 'user-123' })
        .mockResolvedValueOnce({ userId: 'other-user' });

      // Mock states - only first operation needs intervention
      mockCoordinator.loadAgentState
        .mockResolvedValueOnce({
          status: 'waiting_for_human',
          pendingHumanPrompt: 'Please confirm',
          stepCount: 2,
          lastModified: new Date().toISOString(),
        })
        .mockResolvedValueOnce({
          status: 'running',
          stepCount: 1,
          lastModified: new Date().toISOString(),
        });

      const result = await service.getPendingInterventions({
        userId: 'user-123',
      });

      expect(result.totalCount).toBe(1);
      expect(result.pendingInterventions[0]).toEqual({
        operationId: 'operation-1',
        type: 'human_prompt',
        status: 'waiting_for_human',
        pendingHumanPrompt: 'Please confirm',
        stepCount: 2,
        lastModified: expect.any(String),
        userId: undefined, // getOperationMetadata is not called due to the way operations are filtered
        modelRuntimeConfig: undefined,
      });
    });

    it('should return empty list when no interventions needed', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        status: 'running',
        stepCount: 1,
      });
      mockCoordinator.getOperationMetadata.mockResolvedValue({ userId: 'user-123' });

      const result = await service.getPendingInterventions({
        operationId: 'test-operation-1',
      });

      expect(result).toEqual({
        totalCount: 0,
        timestamp: expect.any(String),
        pendingInterventions: [],
      });
    });
  });

  describe('startExecution', () => {
    const mockParams: StartExecutionParams = {
      operationId: 'test-operation-1',
      context: {
        phase: 'user_input',
        payload: {
          message: { content: 'test' },
          sessionId: 'test-operation-1',
          isFirstMessage: false,
        },
        session: { sessionId: 'test-operation-1', status: 'idle', stepCount: 0, messageCount: 0 },
      },
      priority: 'high',
      delay: 500,
    };

    const mockState = {
      operationId: 'test-operation-1',
      status: 'idle',
      stepCount: 2,
      messages: [{ content: 'msg1' }],
      lastModified: new Date().toISOString(),
    };

    const mockMetadata = {
      userId: 'user-123',
      agentConfig: { name: 'test-agent' },
      modelRuntimeConfig: { model: 'gpt-4' },
    };

    beforeEach(() => {
      mockCoordinator.getOperationMetadata.mockResolvedValue(mockMetadata);
      mockCoordinator.loadAgentState.mockResolvedValue(mockState);
      mockQueueService.scheduleMessage.mockResolvedValue('message-456');
    });

    it('should start execution successfully', async () => {
      const result = await service.startExecution(mockParams);

      expect(result).toEqual({
        success: true,
        scheduled: true,
        operationId: 'test-operation-1',
        messageId: 'message-456',
      });

      expect(mockCoordinator.saveAgentState).toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({
          status: 'running',
          lastModified: expect.any(String),
        }),
      );

      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith({
        operationId: 'test-operation-1',
        stepIndex: 2,
        context: mockParams.context,
        endpoint: 'http://localhost:3010/api/agent/run',
        priority: 'high',
        delay: 500,
      });
    });

    it('should create default context when none provided', async () => {
      const paramsWithoutContext = { ...mockParams };
      delete paramsWithoutContext.context;

      await service.startExecution(paramsWithoutContext);

      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith({
        operationId: 'test-operation-1',
        stepIndex: 2,
        context: expect.objectContaining({
          phase: 'user_input',
          payload: expect.objectContaining({
            isFirstMessage: true,
            message: [{ content: '' }], // message is now an array
          }),
          session: expect.objectContaining({
            sessionId: 'test-operation-1',
            status: 'idle',
            stepCount: 2,
            messageCount: 1,
          }),
        }),
        endpoint: 'http://localhost:3010/api/agent/run',
        priority: 'high', // Uses the provided priority from params
        delay: 500, // Uses the provided delay from params
      });
    });

    it('should handle operation not found', async () => {
      mockCoordinator.getOperationMetadata.mockResolvedValue(null);

      await expect(service.startExecution(mockParams)).rejects.toThrow(
        'Operation test-operation-1 not found',
      );
    });

    it('should handle already running operation', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        ...mockState,
        status: 'running',
      });

      await expect(service.startExecution(mockParams)).rejects.toThrow(
        'Operation test-operation-1 is already running',
      );
    });

    it('should handle completed operation', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        ...mockState,
        status: 'done',
      });

      await expect(service.startExecution(mockParams)).rejects.toThrow(
        'Operation test-operation-1 is already completed',
      );
    });

    it('should handle error state operation', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        ...mockState,
        status: 'error',
      });

      await expect(service.startExecution(mockParams)).rejects.toThrow(
        'Operation test-operation-1 is in error state',
      );
    });
  });

  describe('processHumanIntervention', () => {
    it('should process human intervention successfully', async () => {
      mockQueueService.scheduleMessage.mockResolvedValue('message-789');

      const result = await service.processHumanIntervention({
        operationId: 'test-operation-1',
        stepIndex: 2,
        action: 'approve',
        approvedToolCall: { toolName: 'calculator', args: {} },
      });

      expect(result).toEqual({
        messageId: 'message-789',
      });

      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith({
        operationId: 'test-operation-1',
        stepIndex: 2,
        context: undefined,
        endpoint: 'http://localhost:3010/api/agent/run',
        priority: 'high',
        delay: 100,
        payload: {
          approvedToolCall: { toolName: 'calculator', args: {} },
          humanInput: undefined,
          rejectionReason: undefined,
        },
      });
    });

    it('should handle different intervention actions', async () => {
      mockQueueService.scheduleMessage.mockResolvedValue('message-890');

      await service.processHumanIntervention({
        operationId: 'test-operation-1',
        stepIndex: 3,
        action: 'input',
        humanInput: { type: 'text', content: 'user response' },
      });

      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            humanInput: { type: 'text', content: 'user response' },
          }),
        }),
      );
    });
  });

  describe('private methods', () => {
    describe('shouldContinueExecution', () => {
      it('should return false for completed status', () => {
        const shouldContinue = (service as any).shouldContinueExecution(
          { status: 'done' },
          { phase: 'user_input' },
        );
        expect(shouldContinue).toBe(false);
      });

      it('should return false when waiting for human input', () => {
        const shouldContinue = (service as any).shouldContinueExecution(
          { status: 'waiting_for_human' },
          { phase: 'user_input' },
        );
        expect(shouldContinue).toBe(false);
      });

      it('should return false when max steps reached', () => {
        const shouldContinue = (service as any).shouldContinueExecution(
          { status: 'running', maxSteps: 10, stepCount: 10 },
          { phase: 'user_input' },
        );
        expect(shouldContinue).toBe(false);
      });

      it('should return false when cost limit exceeded with stop action', () => {
        const shouldContinue = (service as any).shouldContinueExecution(
          {
            status: 'running',
            cost: { total: 1 },
            costLimit: { maxTotalCost: 0.5, onExceeded: 'stop' },
          },
          { phase: 'user_input' },
        );
        expect(shouldContinue).toBe(false);
      });

      it('should return true when cost limit exceeded with continue action', () => {
        const shouldContinue = (service as any).shouldContinueExecution(
          {
            status: 'running',
            cost: { total: 1 },
            costLimit: { maxTotalCost: 0.5, onExceeded: 'continue' },
          },
          { phase: 'user_input' },
        );
        expect(shouldContinue).toBe(true);
      });

      it('should return false when no context provided', () => {
        const shouldContinue = (service as any).shouldContinueExecution(
          { status: 'running' },
          null,
        );
        expect(shouldContinue).toBe(false);
      });

      it('should return true for normal running state', () => {
        const shouldContinue = (service as any).shouldContinueExecution(
          { status: 'running' },
          { phase: 'user_input' },
        );
        expect(shouldContinue).toBe(true);
      });
    });

    describe('calculateStepDelay', () => {
      it('should return base delay for normal step', () => {
        const delay = (service as any).calculateStepDelay({
          events: [{ type: 'llm_response' }],
        });
        expect(delay).toBe(50);
      });

      it('should return longer delay for tool calls', () => {
        const delay = (service as any).calculateStepDelay({
          events: [{ type: 'tool_result' }],
        });
        expect(delay).toBe(100);
      });

      it('should return exponential backoff delay for errors', () => {
        const delay = (service as any).calculateStepDelay({
          events: [{ type: 'error' }],
        });
        expect(delay).toBe(100);
      });
    });

    describe('calculatePriority', () => {
      it('should return high priority for human input needed', () => {
        const priority = (service as any).calculatePriority({
          newState: { status: 'waiting_for_human' },
          events: [],
        });
        expect(priority).toBe('high');
      });

      it('should return normal priority for errors', () => {
        const priority = (service as any).calculatePriority({
          newState: { status: 'running' },
          events: [{ type: 'error' }],
        });
        expect(priority).toBe('normal');
      });

      it('should return normal priority by default', () => {
        const priority = (service as any).calculatePriority({
          newState: { status: 'running' },
          events: [{ type: 'llm_response' }],
        });
        expect(priority).toBe('normal');
      });
    });
  });
});

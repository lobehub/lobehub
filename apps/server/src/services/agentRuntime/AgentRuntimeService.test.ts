/**
 * @vitest-environment node
 */
import { getModelPropertyWithFallback } from '@lobechat/model-runtime';
import type * as ModelBankModule from 'model-bank';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';

import { AgentRuntimeService } from './AgentRuntimeService';
import { hookDispatcher } from './hooks';
import {
  type AgentExecutionParams,
  type OperationCreationParams,
  type StartExecutionParams,
} from './types';

vi.mock('@lobechat/model-runtime', () => ({
  getModelPropertyWithFallback: vi.fn(),
  // `llmErrorClassification.ts` reads these at module-load time; an empty
  // spec map is fine here because this suite never exercises the runtime
  // retry classifier path.
  ERROR_CODE_SPECS: {},
  getErrorCodeSpec: () => undefined,
  refineErrorCode: () => undefined,
}));

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

// Mock factory and redis dependencies to break env import chains,
// so the barrel can be imported with real AgentRuntimeCoordinator + InMemory backends
vi.mock('@/server/modules/AgentRuntime/factory', async () => {
  const { InMemoryAgentStateManager } =
    await import('@/server/modules/AgentRuntime/InMemoryAgentStateManager');
  const { InMemoryStreamEventManager } =
    await import('@/server/modules/AgentRuntime/InMemoryStreamEventManager');
  return {
    createAgentStateManager: () => new InMemoryAgentStateManager(),
    createStreamEventManager: () => new InMemoryStreamEventManager(),
    isRedisAvailable: () => false,
  };
});

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  createAgentRuntimeRedisClient: vi.fn().mockReturnValue(null),
  getAgentRuntimeRedisClient: vi.fn().mockReturnValue(null),
}));

// Use real AgentRuntimeCoordinator with InMemory backends; only mock unrelated exports
vi.mock('@/server/modules/AgentRuntime', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createRuntimeExecutors: vi.fn(),
  };
});

vi.mock('@lobechat/agent-runtime', () => ({
  AgentRuntime: vi.fn().mockImplementation((_agent, _options) => ({
    step: vi.fn(),
  })),
  // Mirror the real status predicates (packages/agent-runtime/src/utils/status.ts)
  // so completion-lifecycle / getOperationStatus paths don't crash on the mock.
  isBlockedStatus: (status: string) =>
    status === 'waiting_for_human' ||
    status === 'waiting_for_async_tool' ||
    status === 'interrupted',
  isParkedStatus: (status: string) =>
    status === 'waiting_for_human' || status === 'waiting_for_async_tool',
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
  const actual = await importOriginal<typeof ModelBankModule>();
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

    // Get real instances (backed by InMemory implementations)
    mockCoordinator = (service as any).coordinator;
    mockStreamManager = (service as any).streamManager;
    mockQueueService = (service as any).queueService;

    // Auto-spy all coordinator methods so tests can use .mockResolvedValue() / .toHaveBeenCalledWith()
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(mockCoordinator))) {
      if (key !== 'constructor' && typeof mockCoordinator[key] === 'function') {
        vi.spyOn(mockCoordinator, key);
      }
    }
    // Auto-spy all streamManager methods
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(mockStreamManager))) {
      if (key !== 'constructor' && typeof mockStreamManager[key] === 'function') {
        vi.spyOn(mockStreamManager, key);
      }
    }
  });

  afterEach(() => {
    delete process.env.AGENT_RUNTIME_BASE_URL;
    hookDispatcher.unregister('test-operation-1');
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
      toolSet: { manifestMap: {} },
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

    it('should pass maxSteps to initial state when provided', async () => {
      mockQueueService.scheduleMessage.mockResolvedValueOnce('message-123');

      await service.createOperation({ ...mockParams, maxSteps: 25 });

      expect(mockCoordinator.saveAgentState).toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({
          maxSteps: 25,
        }),
      );
    });

    it('should pass evalContext to metadata when provided', async () => {
      mockQueueService.scheduleMessage.mockResolvedValueOnce('message-123');

      const evalContext = { envPrompt: 'You are in a test environment' };
      await service.createOperation({ ...mockParams, evalContext });

      expect(mockCoordinator.saveAgentState).toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({
          metadata: expect.objectContaining({
            evalContext,
          }),
        }),
      );
    });

    it('should abort before creating operation when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort(new Error('startup aborted'));

      await expect(
        service.createOperation({
          ...mockParams,
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({
        message: 'startup aborted',
        name: 'AbortError',
      });

      expect(mockCoordinator.createAgentOperation).not.toHaveBeenCalled();
      expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
    });

    it('should cleanup partially created operation when aborted before scheduling', async () => {
      const controller = new AbortController();
      const originalCreateAgentOperation =
        mockCoordinator.createAgentOperation.getMockImplementation();

      mockCoordinator.createAgentOperation.mockImplementationOnce(async (...args: any[]) => {
        await originalCreateAgentOperation?.(...args);
        controller.abort(new Error('startup aborted'));
      });

      await expect(
        service.createOperation({
          ...mockParams,
          hooks: [{ handler: vi.fn(), id: 'hook-1', type: 'onComplete' }],
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({
        message: 'startup aborted',
        name: 'AbortError',
      });

      expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
      expect(mockCoordinator.deleteAgentOperation).toHaveBeenCalledWith('test-operation-1');
      expect(hookDispatcher.hasHooks('test-operation-1')).toBe(false);
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

    it('should pass resolved contextWindowTokens into compressionConfig', async () => {
      vi.mocked(getModelPropertyWithFallback).mockResolvedValueOnce(200_000);

      let capturedConfig: any;
      const serviceWithFactory = new AgentRuntimeService(mockDb, mockUserId, {
        agentFactory: (config) => {
          capturedConfig = config;
          return { runner: vi.fn() } as any;
        },
      });

      await (serviceWithFactory as any).createAgentRuntime({
        metadata: {
          agentConfig: { chatConfig: { enableContextCompression: true } },
          modelRuntimeConfig: { model: 'gpt-4o-mini', provider: 'openai' },
        },
        operationId: 'test-operation-1',
        stepIndex: 1,
      });

      expect(getModelPropertyWithFallback).toHaveBeenCalledWith(
        'gpt-4o-mini',
        'contextWindowTokens',
        'openai',
      );
      expect(capturedConfig).toEqual(
        expect.objectContaining({
          compressionConfig: expect.objectContaining({
            enabled: true,
            maxWindowToken: 200_000,
          }),
        }),
      );
    });

    it('should fall back to undefined maxWindowToken when model lookup misses', async () => {
      vi.mocked(getModelPropertyWithFallback).mockResolvedValueOnce(undefined);

      let capturedConfig: any;
      const serviceWithFactory = new AgentRuntimeService(mockDb, mockUserId, {
        agentFactory: (config) => {
          capturedConfig = config;
          return { runner: vi.fn() } as any;
        },
      });

      await (serviceWithFactory as any).createAgentRuntime({
        metadata: {
          agentConfig: { chatConfig: { enableContextCompression: true } },
          modelRuntimeConfig: { model: 'unknown-model', provider: 'openai' },
        },
        operationId: 'test-operation-1',
        stepIndex: 1,
      });

      expect(capturedConfig).toEqual(
        expect.objectContaining({
          compressionConfig: expect.objectContaining({
            enabled: true,
            maxWindowToken: undefined,
          }),
        }),
      );
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

    it('should resume async tools with the last pending tool result as parentMessageId', async () => {
      const pendingTools = [
        {
          apiName: 'callSubAgent',
          arguments: '{}',
          id: 'tool-call-1',
          identifier: 'agent-management',
          type: 'default',
        },
        {
          apiName: 'callSubAgent',
          arguments: '{}',
          id: 'tool-call-2',
          identifier: 'agent-management',
          type: 'default',
        },
      ];
      const parkedState = {
        ...mockState,
        interruption: {
          canResume: true,
          interruptedAt: new Date().toISOString(),
          reason: 'async_tool',
        },
        pendingToolsCalling: pendingTools,
        status: 'waiting_for_async_tool',
      };
      const refreshedMessages = [
        { content: 'use tools', id: 'user-msg-1', role: 'user' },
        {
          children: [
            {
              id: 'assistant-msg-1',
              role: 'assistant',
              tools: [
                { ...pendingTools[0], result_msg_id: 'tool-msg-1' },
                { ...pendingTools[1], result_msg_id: 'tool-msg-2' },
              ],
            },
          ],
          id: 'assistant-group-1',
          role: 'assistantGroup',
        },
      ];
      const mockStepResult = {
        events: [],
        newState: { ...parkedState, pendingToolsCalling: [], status: 'done', stepCount: 2 },
        nextContext: null,
      };
      const mockRuntime = { step: vi.fn().mockResolvedValue(mockStepResult) };

      mockCoordinator.loadAgentState.mockResolvedValue(parkedState);
      vi.spyOn(service as any, 'refreshMessagesFromDB').mockResolvedValue(refreshedMessages);
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      await service.executeStep({ ...mockParams, resumeAsyncTool: true });

      expect(mockRuntime.step).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: refreshedMessages,
          pendingToolsCalling: [],
          status: 'running',
        }),
        expect.objectContaining({
          payload: { parentMessageId: 'tool-msg-2' },
          phase: 'user_input',
        }),
      );
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
          errorType: '500',
        },
      });
    });

    it('should dispatch onComplete hook with error in finalState when execution fails', async () => {
      const error = new Error('Runtime error');
      const mockRuntime = { step: vi.fn().mockRejectedValue(error) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

      await expect(service.executeStep(mockParams)).rejects.toThrow('Runtime error');

      // Verify onComplete hooks dispatched with error in finalState as ChatMessageError
      expect(dispatchSpy).toHaveBeenCalledWith(
        'test-operation-1',
        'onComplete',
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
        undefined,
      );

      dispatchSpy.mockRestore();
    });

    it('should dispatch onComplete hook with ChatCompletionErrorPayload in finalState', async () => {
      // Simulate LLM error format: { errorType: 'InvalidProviderAPIKey', error: { ... } }
      const llmError = {
        errorType: 'InvalidProviderAPIKey',
        error: { status: 401 },
        provider: 'openai',
      };
      const mockRuntime = { step: vi.fn().mockRejectedValue(llmError) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

      await expect(service.executeStep(mockParams)).rejects.toEqual(llmError);

      // Verify error is formatted correctly with type from errorType
      expect(dispatchSpy).toHaveBeenCalledWith(
        'test-operation-1',
        'onComplete',
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
        undefined,
      );

      dispatchSpy.mockRestore();
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
      const processSpy = vi.spyOn((service as any).humanIntervention, 'process').mockResolvedValue({
        newState: mockState,
        nextContext: mockParams.context,
      });

      const result = await service.executeStep(paramsWithIntervention);

      expect(processSpy).toHaveBeenCalledWith(mockState, {
        approvedToolCall: paramsWithIntervention.approvedToolCall,
        humanInput: paramsWithIntervention.humanInput,
        rejectAndContinue: undefined,
        rejectionReason: paramsWithIntervention.rejectionReason,
        toolMessageId: undefined,
      });

      expect(result.success).toBe(true);
      expect(result.nextStepScheduled).toBe(false); // Should not schedule next step when status is 'done'
    });

    it('should detect interruption that occurred during step execution', async () => {
      const mockStepResult = {
        newState: { ...mockState, stepCount: 2, status: 'running' },
        nextContext: mockParams.context,
        events: [],
      };

      const mockRuntime = { step: vi.fn().mockResolvedValue(mockStepResult) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      // First call returns running state (for executeStep's initial load),
      // second call returns interrupted state (checked after runtime.step completes)
      mockCoordinator.loadAgentState
        .mockResolvedValueOnce(mockState) // initial load
        .mockResolvedValueOnce({ ...mockState, status: 'interrupted' }); // post-step check

      const result = await service.executeStep(mockParams);

      // The step result should reflect the interrupted status
      expect(result.state).toEqual(expect.objectContaining({ status: 'interrupted' }));
      expect(result.nextStepScheduled).toBe(false);
      // saveStepResult should be called with interrupted state
      expect(mockCoordinator.saveStepResult).toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({
          newState: expect.objectContaining({ status: 'interrupted' }),
        }),
      );
    });
  });

  describe('executeStep - tool result extraction', () => {
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

    it('should extract tool output from data field for single tool_result', async () => {
      const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

      const mockStepResult = {
        newState: { ...mockState, stepCount: 2, status: 'running' },
        nextContext: {
          phase: 'tool_result',
          payload: {
            data: 'Search found 3 results for "weather"',
            executionTime: 120,
            isSuccess: true,
            toolCall: { identifier: 'lobe-web-browsing', apiName: 'search', id: 'tc-1' },
            toolCallId: 'tc-1',
          },
          session: {
            sessionId: 'test-operation-1',
            status: 'running',
            stepCount: 2,
            messageCount: 2,
          },
        },
        events: [],
      };

      const mockRuntime = { step: vi.fn().mockResolvedValue(mockStepResult) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      await service.executeStep(mockParams);

      expect(dispatchSpy).toHaveBeenCalledWith(
        'test-operation-1',
        'afterStep',
        expect.objectContaining({
          toolsResult: [
            expect.objectContaining({
              apiName: 'search',
              identifier: 'lobe-web-browsing',
              output: 'Search found 3 results for "weather"',
            }),
          ],
        }),
        undefined,
      );

      dispatchSpy.mockRestore();
    });

    it('should extract tool output from data field for tools_batch_result', async () => {
      const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

      const mockStepResult = {
        newState: { ...mockState, stepCount: 2, status: 'running' },
        nextContext: {
          phase: 'tools_batch_result',
          payload: {
            parentMessageId: 'msg-1',
            toolCount: 2,
            toolResults: [
              {
                data: 'Result from tool A',
                executionTime: 100,
                isSuccess: true,
                toolCall: { identifier: 'builtin', apiName: 'searchA', id: 'tc-1' },
                toolCallId: 'tc-1',
              },
              {
                data: { items: [1, 2, 3] },
                executionTime: 200,
                isSuccess: true,
                toolCall: { identifier: 'lobe-skills', apiName: 'activateSkill', id: 'tc-2' },
                toolCallId: 'tc-2',
              },
            ],
          },
          session: {
            sessionId: 'test-operation-1',
            status: 'running',
            stepCount: 2,
            messageCount: 3,
          },
        },
        events: [],
      };

      const mockRuntime = { step: vi.fn().mockResolvedValue(mockStepResult) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      await service.executeStep(mockParams);

      expect(dispatchSpy).toHaveBeenCalledWith(
        'test-operation-1',
        'afterStep',
        expect.objectContaining({
          toolsResult: [
            expect.objectContaining({
              apiName: 'searchA',
              identifier: 'builtin',
              output: 'Result from tool A',
            }),
            expect.objectContaining({
              apiName: 'activateSkill',
              identifier: 'lobe-skills',
              output: JSON.stringify({ items: [1, 2, 3] }),
            }),
          ],
        }),
        undefined,
      );

      dispatchSpy.mockRestore();
    });

    it('should handle tool result with undefined data', async () => {
      const dispatchSpy = vi.spyOn(hookDispatcher, 'dispatch').mockResolvedValue(undefined);

      const mockStepResult = {
        newState: { ...mockState, stepCount: 2, status: 'running' },
        nextContext: {
          phase: 'tool_result',
          payload: {
            data: undefined,
            toolCall: { identifier: 'builtin', apiName: 'noop', id: 'tc-1' },
            toolCallId: 'tc-1',
          },
          session: {
            sessionId: 'test-operation-1',
            status: 'running',
            stepCount: 2,
            messageCount: 2,
          },
        },
        events: [],
      };

      const mockRuntime = { step: vi.fn().mockResolvedValue(mockStepResult) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      await service.executeStep(mockParams);

      expect(dispatchSpy).toHaveBeenCalledWith(
        'test-operation-1',
        'afterStep',
        expect.objectContaining({
          toolsResult: [
            expect.objectContaining({
              apiName: 'noop',
              identifier: 'builtin',
              output: undefined,
            }),
          ],
        }),
        undefined,
      );

      dispatchSpy.mockRestore();
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

      it('should not check maxSteps — delegated to runtime.step()', () => {
        // maxSteps is handled by runtime.step() which sets forceFinish → status:'done'
        // shouldContinueExecution only checks status, not maxSteps
        const shouldContinue = (service as any).shouldContinueExecution(
          { status: 'running', maxSteps: 10, stepCount: 10 },
          { phase: 'user_input' },
        );
        expect(shouldContinue).toBe(true);
      });

      it('should continue when forceFinish is active even at maxSteps', () => {
        // When runtime sets forceFinish, the service must allow one more step
        // for the LLM to produce a final text response without tools
        const shouldContinue = (service as any).shouldContinueExecution(
          { status: 'running', maxSteps: 5, stepCount: 6, forceFinish: true },
          { phase: 'llm_result' },
        );
        expect(shouldContinue).toBe(true);
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

  describe('interruptOperation', () => {
    it('should interrupt a running operation', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        operationId: 'op-1',
        status: 'running',
        stepCount: 3,
        lastModified: new Date().toISOString(),
      });

      const result = await service.interruptOperation('op-1');

      expect(result).toBe(true);
      expect(mockCoordinator.saveAgentState).toHaveBeenCalledWith(
        'op-1',
        expect.objectContaining({
          status: 'interrupted',
          lastModified: expect.any(String),
        }),
      );
    });

    it('should interrupt a waiting_for_human operation', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        operationId: 'op-2',
        status: 'waiting_for_human',
        stepCount: 1,
      });

      const result = await service.interruptOperation('op-2');

      expect(result).toBe(true);
      expect(mockCoordinator.saveAgentState).toHaveBeenCalledWith(
        'op-2',
        expect.objectContaining({ status: 'interrupted' }),
      );
    });

    it('should return false when state not found', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue(null);

      const result = await service.interruptOperation('non-existent');

      expect(result).toBe(false);
      expect(mockCoordinator.saveAgentState).not.toHaveBeenCalled();
    });

    it('should return false when operation already done', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        operationId: 'op-done',
        status: 'done',
        stepCount: 5,
      });

      const result = await service.interruptOperation('op-done');

      expect(result).toBe(false);
      expect(mockCoordinator.saveAgentState).not.toHaveBeenCalled();
    });

    it('should return false when operation already in error state', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        operationId: 'op-err',
        status: 'error',
        stepCount: 2,
      });

      const result = await service.interruptOperation('op-err');

      expect(result).toBe(false);
      expect(mockCoordinator.saveAgentState).not.toHaveBeenCalled();
    });

    it('should return false when operation already interrupted', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        operationId: 'op-int',
        status: 'interrupted',
        stepCount: 4,
      });

      const result = await service.interruptOperation('op-int');

      expect(result).toBe(false);
      expect(mockCoordinator.saveAgentState).not.toHaveBeenCalled();
    });
  });

  // Stream events at step / operation boundaries should carry the canonical
  // UIChatMessage[] snapshot so the client can use the pushed payload as
  // Source of Truth instead of refetching from DB.
  describe('queryUiMessages', () => {
    const stubMessageService = (svc: any, queryMessages: ReturnType<typeof vi.fn>) => {
      svc.messageServiceInstance = { queryMessages };
    };

    it('returns messageService.queryMessages result when agentId + topicId are present', async () => {
      const stubMessages = [{ id: 'msg_x', role: 'user' }];
      const queryMessages = vi.fn().mockResolvedValue(stubMessages);
      stubMessageService(service, queryMessages);

      const result = await service.queryUiMessages({
        metadata: { agentId: 'agt_1', topicId: 'tpc_1' },
      } as any);

      expect(queryMessages).toHaveBeenCalledWith({ agentId: 'agt_1', topicId: 'tpc_1' });
      expect(result).toEqual(stubMessages);
    });

    it('returns undefined when agentId or topicId is missing (skips empty-array push)', async () => {
      const queryMessages = vi.fn();
      stubMessageService(service, queryMessages);

      const noAgent = await service.queryUiMessages({
        metadata: { topicId: 'tpc_1' },
      } as any);
      const noTopic = await service.queryUiMessages({
        metadata: { agentId: 'agt_1' },
      } as any);
      const noMeta = await service.queryUiMessages({} as any);

      expect(noAgent).toBeUndefined();
      expect(noTopic).toBeUndefined();
      expect(noMeta).toBeUndefined();
      expect(queryMessages).not.toHaveBeenCalled();
    });

    it('returns undefined and never throws when DB query fails (stream events must not fail the step)', async () => {
      const queryMessages = vi.fn().mockRejectedValue(new Error('db down'));
      stubMessageService(service, queryMessages);

      const result = await service.queryUiMessages({
        metadata: { agentId: 'agt_1', topicId: 'tpc_1' },
      } as any);

      expect(result).toBeUndefined();
    });
  });

  describe('tryResumeParentFromAsyncTool', () => {
    const parentOpId = 'parent-op-async';

    const fulfilledPlugin = { id: 'msg-tc1', state: { status: 'completed' }, toolCallId: 'tc1' };

    const stubFulfilled = () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [{ id: 'tc1' }],
        status: 'waiting_for_async_tool',
        stepCount: 3,
      });
      (service as any).serverDB.query = {
        messagePlugins: { findFirst: vi.fn().mockResolvedValue(fulfilledPlugin) },
      };
      (service as any).messageModel.findById = vi.fn().mockResolvedValue({ content: 'answer' });
    };

    it('wins the CAS and schedules the resume step when all pending tools are fulfilled', async () => {
      stubFulfilled();
      const casSpy = vi
        .spyOn(AgentOperationModel.prototype, 'tryResumeFromAsyncTool')
        .mockResolvedValue(true);

      const won = await service.tryResumeParentFromAsyncTool({ parentOperationId: parentOpId });

      expect(won).toBe(true);
      expect(casSpy).toHaveBeenCalledWith(parentOpId);
      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: parentOpId,
          payload: { resumeAsyncTool: true },
          priority: 'high',
          stepIndex: 3,
        }),
      );
    });

    it('holds (no CAS, no schedule) when a pending tool is not yet fulfilled', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [{ id: 'tc1' }],
        status: 'waiting_for_async_tool',
        stepCount: 1,
      });
      (service as any).serverDB.query = {
        messagePlugins: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      const casSpy = vi.spyOn(AgentOperationModel.prototype, 'tryResumeFromAsyncTool');

      const won = await service.tryResumeParentFromAsyncTool({ parentOperationId: parentOpId });

      expect(won).toBe(false);
      expect(casSpy).not.toHaveBeenCalled();
      expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
    });

    it('does not schedule when it loses the CAS to a concurrent sibling', async () => {
      stubFulfilled();
      vi.spyOn(AgentOperationModel.prototype, 'tryResumeFromAsyncTool').mockResolvedValue(false);

      const won = await service.tryResumeParentFromAsyncTool({ parentOperationId: parentOpId });

      expect(won).toBe(false);
      expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
    });

    it('skips when the parent is no longer parked', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [],
        status: 'running',
        stepCount: 1,
      });
      const casSpy = vi.spyOn(AgentOperationModel.prototype, 'tryResumeFromAsyncTool');

      const won = await service.tryResumeParentFromAsyncTool({ parentOperationId: parentOpId });

      expect(won).toBe(false);
      expect(casSpy).not.toHaveBeenCalled();
    });

    it('arms the first verify (attempt 1, 15s) when the parent has not parked yet and scheduleVerifyOnHold is set', async () => {
      // Child completed before the parent's parking step persisted its state.
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [],
        status: 'running',
        stepCount: 2,
      });

      const won = await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { scheduleVerifyOnHold: true },
      );

      expect(won).toBe(false);
      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          delay: 15_000,
          operationId: parentOpId,
          payload: { asyncToolVerifyAttempt: 1, verifyAsyncToolBarrier: true },
          stepIndex: 2,
        }),
      );
    });

    it('arms a verify when the barrier is unsatisfied and scheduleVerifyOnHold is set', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [{ id: 'tc1' }],
        status: 'waiting_for_async_tool',
        stepCount: 1,
      });
      (service as any).serverDB.query = {
        messagePlugins: { findFirst: vi.fn().mockResolvedValue(null) },
      };

      const won = await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { scheduleVerifyOnHold: true },
      );

      expect(won).toBe(false);
      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { asyncToolVerifyAttempt: 1, verifyAsyncToolBarrier: true },
        }),
      );
    });

    it('re-arms the next verify with exponential backoff while the barrier holds', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [{ id: 'tc1' }],
        status: 'waiting_for_async_tool',
        stepCount: 1,
      });
      (service as any).serverDB.query = {
        messagePlugins: { findFirst: vi.fn().mockResolvedValue(null) },
      };

      // A verify handler running as attempt 2 re-arms attempt 3 (60s).
      await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { scheduleVerifyOnHold: true, verifyAttempt: 3 },
      );

      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          delay: 60_000,
          payload: { asyncToolVerifyAttempt: 3, verifyAsyncToolBarrier: true },
        }),
      );
    });

    it('stops re-arming once the bounded attempts are exhausted', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [{ id: 'tc1' }],
        status: 'waiting_for_async_tool',
        stepCount: 1,
      });
      (service as any).serverDB.query = {
        messagePlugins: { findFirst: vi.fn().mockResolvedValue(null) },
      };

      const won = await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { scheduleVerifyOnHold: true, verifyAttempt: 6 },
      );

      expect(won).toBe(false);
      expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
    });

    it('trusts a just-backfilled message id without re-reading it (read-your-writes)', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [{ id: 'tc1' }],
        status: 'waiting_for_async_tool',
        stepCount: 3,
      });
      // Plugin row exists (created at park) but its state still reads stale.
      const findById = vi.fn().mockResolvedValue({ content: '' });
      (service as any).serverDB.query = {
        messagePlugins: {
          findFirst: vi.fn().mockResolvedValue({ id: 'msg-tc1', state: null, toolCallId: 'tc1' }),
        },
      };
      (service as any).messageModel.findById = findById;
      const casSpy = vi
        .spyOn(AgentOperationModel.prototype, 'tryResumeFromAsyncTool')
        .mockResolvedValue(true);

      const won = await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { knownFulfilledMessageId: 'msg-tc1' },
      );

      expect(won).toBe(true);
      expect(casSpy).toHaveBeenCalledWith(parentOpId);
      // The stale read must be skipped — barrier trusted the local backfill.
      expect(findById).not.toHaveBeenCalled();
    });

    it('arms a fallback verify when a parked op has no pending tools', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [],
        status: 'waiting_for_async_tool',
        stepCount: 4,
      });
      const casSpy = vi.spyOn(AgentOperationModel.prototype, 'tryResumeFromAsyncTool');

      const won = await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { scheduleVerifyOnHold: true },
      );

      expect(won).toBe(false);
      expect(casSpy).not.toHaveBeenCalled();
      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { asyncToolVerifyAttempt: 1, verifyAsyncToolBarrier: true },
          stepIndex: 4,
        }),
      );
    });

    it('does not arm a verify for terminal parent states', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [],
        status: 'done',
        stepCount: 5,
      });

      const won = await service.tryResumeParentFromAsyncTool(
        { parentOperationId: parentOpId },
        { scheduleVerifyOnHold: true },
      );

      expect(won).toBe(false);
      expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
    });

    it('schedules a finish step when the parked tool requests onComplete=finish (skipCallSupervisor / delegate)', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        pendingToolsCalling: [{ id: 'tc1' }],
        status: 'waiting_for_async_tool',
        stepCount: 4,
      });
      (service as any).serverDB.query = {
        messagePlugins: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'msg-tc1',
            state: { onComplete: 'finish', status: 'completed' },
            toolCallId: 'tc1',
          }),
        },
      };
      (service as any).messageModel.findById = vi.fn().mockResolvedValue({ content: 'answer' });
      vi.spyOn(AgentOperationModel.prototype, 'tryResumeFromAsyncTool').mockResolvedValue(true);

      const won = await service.tryResumeParentFromAsyncTool({ parentOperationId: parentOpId });

      expect(won).toBe(true);
      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { finishAfterAsyncTool: true }, stepIndex: 4 }),
      );
    });
  });

  describe('completeGroupActionMember', () => {
    const memberState = {
      messages: [
        { content: 'question', role: 'user' },
        { content: 'final answer', role: 'assistant' },
      ],
      metadata: { agentId: 'agent-a' },
      modelRuntimeConfig: { model: 'gpt-test' },
      status: 'done',
      usage: { llm: { tokens: { total: 42 } }, tools: { totalCalls: 2 } },
    };

    let updateToolMessage: ReturnType<typeof vi.fn>;
    let resumeSpy: MockInstance<AgentRuntimeService['tryResumeParentFromAsyncTool']>;

    beforeEach(() => {
      updateToolMessage = vi.fn().mockResolvedValue({ success: true });
      (service as any).messageModel.updateToolMessage = updateToolMessage;
      resumeSpy = vi.spyOn(service, 'tryResumeParentFromAsyncTool').mockResolvedValue(true);
    });

    it('single in-group member: backfills a receipt onto the group tool and resumes', async () => {
      const won = await service.completeGroupActionMember({
        anchorMessageId: 'grp-tool-1',
        expectedMembers: 1,
        finalState: memberState as any,
        groupToolMessageId: 'grp-tool-1',
        mode: 'in_group',
        onComplete: 'resume',
        operationId: 'child-1',
        parentOperationId: 'parent-1',
        reason: 'done',
      });

      expect(won).toBe(true);
      expect(updateToolMessage).toHaveBeenCalledWith(
        'grp-tool-1',
        expect.objectContaining({
          content: 'Agent agent-a responded in the group.',
          pluginState: expect.objectContaining({ status: 'completed' }),
        }),
      );
      expect(resumeSpy).toHaveBeenCalledWith(
        { parentOperationId: 'parent-1' },
        { scheduleVerifyOnHold: true },
      );
    });

    it('single isolated member: backfills the final answer', async () => {
      await service.completeGroupActionMember({
        anchorMessageId: 'grp-tool-1',
        expectedMembers: 1,
        finalState: memberState as any,
        groupToolMessageId: 'grp-tool-1',
        mode: 'isolated',
        onComplete: 'resume',
        operationId: 'child-1',
        parentOperationId: 'parent-1',
        reason: 'done',
      });

      expect(updateToolMessage).toHaveBeenCalledWith(
        'grp-tool-1',
        expect.objectContaining({ content: 'final answer' }),
      );
    });

    it('multi-member: holds (no group-tool backfill, no resume) until the barrier is met', async () => {
      (service as any).serverDB.query = {
        messagePlugins: { findFirst: vi.fn() },
        messages: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ content: 'a note', id: 'anchor-0', role: 'tool' }]),
        },
      };
      mockCoordinator.loadAgentState.mockResolvedValue({
        status: 'waiting_for_async_tool',
        stepCount: 1,
      });

      const won = await service.completeGroupActionMember({
        anchorMessageId: 'anchor-0',
        expectedMembers: 2,
        finalState: memberState as any,
        groupToolMessageId: 'grp-tool-1',
        mode: 'in_group',
        onComplete: 'resume',
        operationId: 'child-1',
        parentOperationId: 'parent-1',
        reason: 'done',
      });

      expect(won).toBe(false);
      expect(updateToolMessage).toHaveBeenCalledWith('anchor-0', expect.anything());
      expect(updateToolMessage).not.toHaveBeenCalledWith('grp-tool-1', expect.anything());
      expect(resumeSpy).not.toHaveBeenCalled();
    });

    it('multi-member: last completion backfills the group tool and resumes', async () => {
      (service as any).serverDB.query = {
        messagePlugins: { findFirst: vi.fn() },
        messages: {
          findMany: vi.fn().mockResolvedValue([
            { content: 'a', id: 'anchor-0', role: 'tool' },
            { content: 'b', id: 'anchor-1', role: 'tool' },
          ]),
        },
      };

      const won = await service.completeGroupActionMember({
        anchorMessageId: 'anchor-1',
        expectedMembers: 2,
        finalState: memberState as any,
        groupToolMessageId: 'grp-tool-1',
        mode: 'in_group',
        onComplete: 'resume',
        operationId: 'child-2',
        parentOperationId: 'parent-1',
        reason: 'done',
      });

      expect(won).toBe(true);
      expect(updateToolMessage).toHaveBeenCalledWith('anchor-1', expect.anything());
      expect(updateToolMessage).toHaveBeenCalledWith(
        'grp-tool-1',
        expect.objectContaining({
          content: 'All 2 agent members completed.',
          pluginState: expect.objectContaining({ status: 'completed' }),
        }),
      );
      expect(resumeSpy).toHaveBeenCalled();
    });

    it('throws when the anchor backfill fails so the webhook redelivers', async () => {
      updateToolMessage.mockResolvedValue({ success: false });

      await expect(
        service.completeGroupActionMember({
          anchorMessageId: 'grp-tool-1',
          expectedMembers: 1,
          finalState: memberState as any,
          groupToolMessageId: 'grp-tool-1',
          mode: 'in_group',
          onComplete: 'resume',
          operationId: 'child-1',
          parentOperationId: 'parent-1',
          reason: 'done',
        }),
      ).rejects.toThrow(/failed to backfill anchor/);
      expect(resumeSpy).not.toHaveBeenCalled();
    });
  });

  describe('completeSubAgentBridge', () => {
    const bridgeParams = {
      operationId: 'child-op-1',
      parentOperationId: 'parent-op-1',
      reason: 'done',
      threadId: 'thread-1',
      toolMessageId: 'tool-msg-1',
    };

    const childState = {
      messages: [
        { content: 'question', role: 'user' },
        { content: 'final answer', role: 'assistant' },
      ],
      modelRuntimeConfig: { model: 'gpt-test' },
      status: 'done',
      usage: { llm: { tokens: { total: 42 } }, tools: { totalCalls: 2 } },
    };

    let updateToolMessage: ReturnType<typeof vi.fn>;
    let resumeSpy: MockInstance<AgentRuntimeService['tryResumeParentFromAsyncTool']>;

    beforeEach(() => {
      updateToolMessage = vi.fn().mockResolvedValue({ success: true });
      (service as any).messageModel.updateToolMessage = updateToolMessage;
      resumeSpy = vi.spyOn(service, 'tryResumeParentFromAsyncTool').mockResolvedValue(true);
    });

    it('backfills the tool message from finalState and resumes with scheduleVerifyOnHold', async () => {
      const won = await service.completeSubAgentBridge({
        ...bridgeParams,
        finalState: childState as any,
      });

      expect(won).toBe(true);
      expect(updateToolMessage).toHaveBeenCalledWith('tool-msg-1', {
        content: 'final answer',
        pluginError: undefined,
        pluginState: {
          model: 'gpt-test',
          status: 'completed',
          threadId: 'thread-1',
          totalToolCalls: 2,
          totalTokens: 42,
        },
      });
      expect(resumeSpy).toHaveBeenCalledWith(
        { parentOperationId: 'parent-op-1' },
        { knownFulfilledMessageId: 'tool-msg-1', scheduleVerifyOnHold: true },
      );
    });

    it('loads the child state from the coordinator when finalState is not passed (webhook path)', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue(childState);

      await service.completeSubAgentBridge(bridgeParams);

      expect(mockCoordinator.loadAgentState).toHaveBeenCalledWith('child-op-1');
      expect(updateToolMessage).toHaveBeenCalledWith(
        'tool-msg-1',
        expect.objectContaining({ content: 'final answer' }),
      );
    });

    it('writes an error note + pluginError when the child failed', async () => {
      await service.completeSubAgentBridge({
        ...bridgeParams,
        finalState: { ...childState, error: { message: 'boom' } } as any,
        reason: 'error',
      });

      expect(updateToolMessage).toHaveBeenCalledWith(
        'tool-msg-1',
        expect.objectContaining({
          content: 'Sub-agent did not complete (error).',
          pluginError: { message: 'boom' },
          pluginState: expect.objectContaining({ status: 'error' }),
        }),
      );
    });

    it('throws when the backfill reports success: false so the webhook path redelivers', async () => {
      // updateToolMessage swallows transaction errors into { success: false } —
      // acking 200 here would strand the parent: the barrier stays unsatisfied
      // and QStash never retries an acknowledged delivery.
      updateToolMessage.mockResolvedValue({ success: false });

      await expect(
        service.completeSubAgentBridge({ ...bridgeParams, finalState: childState as any }),
      ).rejects.toThrow(/failed to backfill/);
      expect(resumeSpy).not.toHaveBeenCalled();
    });

    it('propagates backfill infrastructure errors for the same redelivery', async () => {
      updateToolMessage.mockRejectedValue(new Error('db down'));

      await expect(
        service.completeSubAgentBridge({ ...bridgeParams, finalState: childState as any }),
      ).rejects.toThrow('db down');
      expect(resumeSpy).not.toHaveBeenCalled();
    });
  });

  describe('resolveAsyncToolOnComplete', () => {
    it('returns finish when ANY pending tool requests finish (not just the first)', async () => {
      // First pending tool resumes; a later one is a group finish action. The
      // disposition must scan all pending tools, not only pending[0].
      (service as any).serverDB.query = {
        messagePlugins: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({ state: { status: 'completed' } })
            .mockResolvedValueOnce({ state: { onComplete: 'finish', status: 'completed' } }),
        },
      };

      const result = await (service as any).resolveAsyncToolOnComplete([
        { id: 'tc1' },
        { id: 'tc2' },
      ]);

      expect(result).toBe('finish');
    });

    it('returns resume when no pending tool requests finish', async () => {
      (service as any).serverDB.query = {
        messagePlugins: {
          findFirst: vi.fn().mockResolvedValue({ state: { status: 'completed' } }),
        },
      };

      const result = await (service as any).resolveAsyncToolOnComplete([
        { id: 'tc1' },
        { id: 'tc2' },
      ]);

      expect(result).toBe('resume');
    });
  });

  describe('group member timeout watchdog', () => {
    const timeoutParams = {
      anchorMessageId: 'anchor-1',
      expectedMembers: 1,
      groupToolMessageId: 'grp-tool-1',
      memberOperationId: 'member-op-1',
      mode: 'isolated' as const,
      onComplete: 'resume' as const,
      parentOperationId: 'parent-1',
    };

    it('no-ops when the member already reached a terminal state', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({ status: 'done' });
      const interruptSpy = vi.spyOn(service, 'interruptOperation');
      const bridgeSpy = vi.spyOn(service, 'completeGroupActionMember');

      const result = await service.executeStep({
        groupMemberTimeout: timeoutParams,
        operationId: 'member-op-1',
        stepIndex: 0,
      } as any);

      expect(result.success).toBe(true);
      expect(result.nextStepScheduled).toBe(false);
      expect(interruptSpy).not.toHaveBeenCalled();
      expect(bridgeSpy).not.toHaveBeenCalled();
    });

    it('interrupts the member and bridges a timeout when it is still running', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({ status: 'running' });
      const interruptSpy = vi.spyOn(service, 'interruptOperation').mockResolvedValue(true);
      const bridgeSpy = vi.spyOn(service, 'completeGroupActionMember').mockResolvedValue(true);

      const result = await service.executeStep({
        groupMemberTimeout: timeoutParams,
        operationId: 'member-op-1',
        stepIndex: 0,
      } as any);

      expect(interruptSpy).toHaveBeenCalledWith('member-op-1');
      expect(bridgeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          onComplete: 'resume',
          operationId: 'member-op-1',
          parentOperationId: 'parent-1',
          reason: 'timeout',
        }),
      );
      expect(result.nextStepScheduled).toBe(true);
    });
  });
});

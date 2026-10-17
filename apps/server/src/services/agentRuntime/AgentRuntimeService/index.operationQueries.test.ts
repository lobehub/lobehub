/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '../hooks';
import { type StartExecutionParams } from '../types';
import { AgentRuntimeService } from '.';
import { setUpService } from './testUtils';

vi.mock('@lobechat/model-runtime', (...args) =>
  import('./testUtils').then((m) =>
    (m.lobechatModelRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

const { ssrfSafeFetch: mockSsrfSafeFetch } = vi.hoisted(() => ({ ssrfSafeFetch: vi.fn() }));

vi.mock('@lobechat/ssrf-safe-fetch', () => ({ ssrfSafeFetch: mockSsrfSafeFetch }));

// Mock trusted client to avoid server-side env access
vi.mock('@/libs/trusted-client', (...args) =>
  import('./testUtils').then((m) => (m.libsTrustedClientModule as (...a: any[]) => any)(...args)),
);

// Mock database and models
vi.mock('@/server/services/file', (...args) =>
  import('./testUtils').then((m) => (m.serverServicesFileModule as (...a: any[]) => any)(...args)),
);

vi.mock('@/database/models/message', (...args) =>
  import('./testUtils').then((m) =>
    (m.databaseModelsMessageModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/database/models/agent', (...args) =>
  import('./testUtils').then((m) => (m.databaseModelsAgentModule as (...a: any[]) => any)(...args)),
);

vi.mock('@/database/models/plugin', (...args) =>
  import('./testUtils').then((m) =>
    (m.databaseModelsPluginModule as (...a: any[]) => any)(...args),
  ),
);

// Mock ModelRuntime to avoid server-side env access
vi.mock('@/server/modules/ModelRuntime', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesModelRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

// Mock search service to avoid server-side env access
vi.mock('@/server/services/search', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverServicesSearchModule as (...a: any[]) => any)(...args),
  ),
);

// Mock factory and redis dependencies to break env import chains,
// so the barrel can be imported with real AgentRuntimeCoordinator + InMemory backends
vi.mock('@/server/modules/AgentRuntime/factory', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesAgentRuntimeFactoryModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/server/modules/AgentRuntime/redis', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesAgentRuntimeRedisModule as (...a: any[]) => any)(...args),
  ),
);

// Use real AgentRuntimeCoordinator with InMemory backends; only mock unrelated exports
vi.mock('@/server/modules/AgentRuntime', (...args) =>
  import('./testUtils').then((m) =>
    (m.serverModulesAgentRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

// Spread the real module and override only `AgentRuntime` (to stub `.step()`).
// Keeps the real status predicates + package-hosted executors (e.g. `finish`),
// so this mock survives future executor migrations without edits.
vi.mock('@lobechat/agent-runtime', (...args) =>
  import('./testUtils').then((m) =>
    (m.lobechatAgentRuntimeModule as (...a: any[]) => any)(...args),
  ),
);

vi.mock('@/server/services/queue', (...args) =>
  import('./testUtils').then((m) => (m.serverServicesQueueModule as (...a: any[]) => any)(...args)),
);

// Mock Mecha module
vi.mock('@/server/modules/Mecha', (...args) =>
  import('./testUtils').then((m) => (m.serverModulesMechaModule as (...a: any[]) => any)(...args)),
);

// Mock model-bank
vi.mock('model-bank', (...args) =>
  import('./testUtils').then((m) => (m.modelBankModule as (...a: any[]) => any)(...args)),
);

describe('AgentRuntimeService', () => {
  let service: AgentRuntimeService;
  let mockCoordinator: any;
  let mockStreamManager: any;
  let mockQueueService: any;
  const mockUserId = 'test-user-id';

  beforeEach(() => {
    ({ service, mockCoordinator, mockStreamManager, mockQueueService } = setUpService(
      AgentRuntimeService,
      mockUserId,
    ));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AGENT_RUNTIME_BASE_URL;
    hookDispatcher.unregister('test-operation-1');
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

    it('should reject restarting an interrupted operation', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        ...mockState,
        status: 'interrupted',
      });

      await expect(service.startExecution(mockParams)).rejects.toThrow(
        'Operation test-operation-1 is interrupted',
      );
      expect(mockCoordinator.saveAgentState).not.toHaveBeenCalled();
      expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
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
});

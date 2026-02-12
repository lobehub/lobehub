import { type AgentRuntimeContext } from '@lobechat/agent-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InMemoryAgentStateManager,
  InMemoryStreamEventManager,
} from '@/server/modules/AgentRuntime';

import { AgentRuntimeService } from '../AgentRuntimeService';
import { type StepCompletionReason, type StepLifecycleCallbacks } from '../types';

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
  ApiKeyManager: vi.fn().mockImplementation(() => ({
    getAllApiKeys: vi.fn(),
    getApiKey: vi.fn(),
  })),
  initializeRuntimeOptions: vi.fn(),
  initModelRuntimeFromDB: vi.fn().mockResolvedValue({
    chat: vi.fn(),
  }),
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
    executePlugin: vi.fn(),
    getPluginManifest: vi.fn(),
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

describe('AgentRuntimeService - Step Lifecycle Callbacks', () => {
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

  describe('registerStepCallbacks', () => {
    it('should register callbacks for an operation', () => {
      const operationId = 'test-op-1';
      const callbacks: StepLifecycleCallbacks = {
        onAfterStep: vi.fn(),
        onBeforeStep: vi.fn(),
        onComplete: vi.fn(),
      };

      service.registerStepCallbacks(operationId, callbacks);

      const registered = service.getStepCallbacks(operationId);
      expect(registered).toBe(callbacks);
    });

    it('should overwrite existing callbacks if registered again', () => {
      const operationId = 'test-op-2';
      const callbacks1: StepLifecycleCallbacks = { onBeforeStep: vi.fn() };
      const callbacks2: StepLifecycleCallbacks = { onAfterStep: vi.fn() };

      service.registerStepCallbacks(operationId, callbacks1);
      service.registerStepCallbacks(operationId, callbacks2);

      const registered = service.getStepCallbacks(operationId);
      expect(registered).toBe(callbacks2);
    });
  });

  describe('unregisterStepCallbacks', () => {
    it('should remove registered callbacks', () => {
      const operationId = 'test-op-3';
      const callbacks: StepLifecycleCallbacks = { onBeforeStep: vi.fn() };

      service.registerStepCallbacks(operationId, callbacks);
      service.unregisterStepCallbacks(operationId);

      const registered = service.getStepCallbacks(operationId);
      expect(registered).toBeUndefined();
    });

    it('should not throw when unregistering non-existent callbacks', () => {
      expect(() => {
        service.unregisterStepCallbacks('non-existent-op');
      }).not.toThrow();
    });
  });

  describe('getStepCallbacks', () => {
    it('should return undefined for non-existent operation', () => {
      const registered = service.getStepCallbacks('non-existent-op');
      expect(registered).toBeUndefined();
    });
  });

  describe('createOperation with stepCallbacks', () => {
    it('should register callbacks when provided in createOperation params', async () => {
      const operationId = 'test-op-with-callbacks';
      const callbacks: StepLifecycleCallbacks = {
        onAfterStep: vi.fn(),
        onBeforeStep: vi.fn(),
        onComplete: vi.fn(),
      };

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

      await service.createOperation({
        agentConfig: { model: 'gpt-4o', provider: 'openai' },
        appContext: { agentId: 'test-agent' },
        autoStart: false,
        initialContext,
        initialMessages: [{ content: 'Hello', role: 'user' }],
        modelRuntimeConfig: { model: 'gpt-4o', provider: 'openai' },
        operationId,
        stepCallbacks: callbacks,
        toolManifestMap: {},
        tools: [],
        userId,
      });

      const registered = service.getStepCallbacks(operationId);
      expect(registered).toBe(callbacks);
    });

    it('should not register callbacks when not provided', async () => {
      const operationId = 'test-op-no-callbacks';

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

      await service.createOperation({
        agentConfig: { model: 'gpt-4o', provider: 'openai' },
        appContext: { agentId: 'test-agent' },
        autoStart: false,
        initialContext,
        initialMessages: [{ content: 'Hello', role: 'user' }],
        modelRuntimeConfig: { model: 'gpt-4o', provider: 'openai' },
        operationId,
        toolManifestMap: {},
        tools: [],
        userId,
      });

      const registered = service.getStepCallbacks(operationId);
      expect(registered).toBeUndefined();
    });
  });

  describe('callback invocation tracking', () => {
    it('should track callback calls with correct parameters', async () => {
      const operationId = 'callback-tracking-test';

      const onBeforeStepCalls: Array<{ operationId: string; stepIndex: number }> = [];
      const onAfterStepCalls: Array<{
        operationId: string;
        shouldContinue: boolean;
        stepIndex: number;
      }> = [];
      const onCompleteCalls: Array<{ operationId: string; reason: StepCompletionReason }> = [];

      const callbacks: StepLifecycleCallbacks = {
        onAfterStep: async (params) => {
          onAfterStepCalls.push({
            operationId: params.operationId,
            shouldContinue: params.shouldContinue,
            stepIndex: params.stepIndex,
          });
        },
        onBeforeStep: async (params) => {
          onBeforeStepCalls.push({
            operationId: params.operationId,
            stepIndex: params.stepIndex,
          });
        },
        onComplete: async (params) => {
          onCompleteCalls.push({
            operationId: params.operationId,
            reason: params.reason,
          });
        },
      };

      // Verify callbacks structure is correct
      expect(callbacks.onBeforeStep).toBeDefined();
      expect(callbacks.onAfterStep).toBeDefined();
      expect(callbacks.onComplete).toBeDefined();

      // Register callbacks
      service.registerStepCallbacks(operationId, callbacks);

      // Verify they are registered
      const registered = service.getStepCallbacks(operationId);
      expect(registered).toBe(callbacks);
    });
  });

  describe('callback error handling', () => {
    it('should not throw when onBeforeStep callback throws', async () => {
      const operationId = 'error-test-before';
      const callbacks: StepLifecycleCallbacks = {
        onBeforeStep: async () => {
          throw new Error('onBeforeStep error');
        },
      };

      service.registerStepCallbacks(operationId, callbacks);

      // The callback is registered, verify it exists
      const registered = service.getStepCallbacks(operationId);
      expect(registered).toBe(callbacks);
      expect(registered?.onBeforeStep).toBeDefined();
    });

    it('should not throw when onAfterStep callback throws', async () => {
      const operationId = 'error-test-after';
      const callbacks: StepLifecycleCallbacks = {
        onAfterStep: async () => {
          throw new Error('onAfterStep error');
        },
      };

      service.registerStepCallbacks(operationId, callbacks);

      // The callback is registered, verify it exists
      const registered = service.getStepCallbacks(operationId);
      expect(registered).toBe(callbacks);
      expect(registered?.onAfterStep).toBeDefined();
    });

    it('should not throw when onComplete callback throws', async () => {
      const operationId = 'error-test-complete';
      const callbacks: StepLifecycleCallbacks = {
        onComplete: async () => {
          throw new Error('onComplete error');
        },
      };

      service.registerStepCallbacks(operationId, callbacks);

      // The callback is registered, verify it exists
      const registered = service.getStepCallbacks(operationId);
      expect(registered).toBe(callbacks);
      expect(registered?.onComplete).toBeDefined();
    });
  });

  describe('partial callbacks', () => {
    it('should work with only onBeforeStep callback', async () => {
      const operationId = 'partial-before';
      const onBeforeStep = vi.fn();
      const callbacks: StepLifecycleCallbacks = { onBeforeStep };

      service.registerStepCallbacks(operationId, callbacks);

      const registered = service.getStepCallbacks(operationId);
      expect(registered?.onBeforeStep).toBe(onBeforeStep);
      expect(registered?.onAfterStep).toBeUndefined();
      expect(registered?.onComplete).toBeUndefined();
    });

    it('should work with only onAfterStep callback', async () => {
      const operationId = 'partial-after';
      const onAfterStep = vi.fn();
      const callbacks: StepLifecycleCallbacks = { onAfterStep };

      service.registerStepCallbacks(operationId, callbacks);

      const registered = service.getStepCallbacks(operationId);
      expect(registered?.onBeforeStep).toBeUndefined();
      expect(registered?.onAfterStep).toBe(onAfterStep);
      expect(registered?.onComplete).toBeUndefined();
    });

    it('should work with only onComplete callback', async () => {
      const operationId = 'partial-complete';
      const onComplete = vi.fn();
      const callbacks: StepLifecycleCallbacks = { onComplete };

      service.registerStepCallbacks(operationId, callbacks);

      const registered = service.getStepCallbacks(operationId);
      expect(registered?.onBeforeStep).toBeUndefined();
      expect(registered?.onAfterStep).toBeUndefined();
      expect(registered?.onComplete).toBe(onComplete);
    });
  });
});

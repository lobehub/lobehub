/**
 * @vitest-environment node
 */
import { getModelPropertyWithFallback } from '@lobechat/model-runtime';
import type { UIChatMessage } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '../../hooks';
import { type AgentExecutionParams } from '../../types';
import { AgentRuntimeService } from '..';
import { buildPersistedToolChain, setUpService } from './testUtils';

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
  let mockDb: any;
  const mockUserId = 'test-user-id';

  beforeEach(() => {
    ({ service, mockCoordinator, mockStreamManager, mockQueueService, mockDb } = setUpService(
      AgentRuntimeService,
      mockUserId,
    ));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AGENT_RUNTIME_BASE_URL;
    hookDispatcher.unregister('test-operation-1');
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

    it('acks a delayed delivery after the durable operation was abandoned', async () => {
      vi.spyOn((service as any).agentOperationModel, 'findById').mockResolvedValue({
        id: mockParams.operationId,
        status: 'abandoned',
      });

      const result = await service.executeStep(mockParams);

      expect(result).toEqual({
        nextStepScheduled: false,
        state: { status: 'interrupted' },
        stepResult: null,
        success: true,
      });
      expect(mockCoordinator.tryClaimStep).not.toHaveBeenCalled();
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
        agentState: {
          world: { agent: { chatConfig: { enableContextCompression: true } } as any },
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
        agentState: {
          world: { agent: { chatConfig: { enableContextCompression: true } } as any },
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

    it.each([false, true])(
      'reuses the entry read for device discovery (device=%s)',
      async (withDevice) => {
        const state = {
          ...mockState,
          messages: [],
          origin: { agentId: 'agent-1', topicId: 'topic-1' },
        };
        mockCoordinator.loadAgentState.mockResolvedValue(state);
        const dbMessages = buildPersistedToolChain('full model answer');
        dbMessages[0].imageList = [{ id: 'file-1', url: 'raw/image', alt: 'image' }];
        if (withDevice) {
          dbMessages[0] = {
            ...dbMessages[0],
            role: 'tool',
            pluginState: { metadata: { activeDeviceId: 'device-1', devicePlatform: 'darwin' } },
          };
        }
        const query = (service as any).messageModel.query.mockResolvedValue(dbMessages);
        vi.spyOn((service as any).messageService, 'prepareUiMessages').mockResolvedValue([]);
        const step = vi.fn().mockImplementation(async (input) => ({
          events: [],
          newState: { ...input, stepCount: 2 },
          nextContext: mockParams.context,
        }));
        vi.spyOn(service as any, 'createAgentRuntime').mockResolvedValue({ runtime: { step } });

        const result = await service.executeStep(mockParams);

        expect(result.success).toBe(true);
        expect(query).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(step.mock.calls[0][0].messages)).toContain('full model answer');
        expect(JSON.stringify(step.mock.calls[0][0].messages)).toContain('model:raw/image');
        expect(dbMessages[0].imageList?.[0].url).toBe('raw/image');
        expect(step.mock.calls[0][0].binding?.device?.id).toBe(withDevice ? 'device-1' : undefined);
      },
    );

    // The executors read the device id through the same gate, so binding one for
    // a run that may not touch a device buys nothing — and its working directory
    // and system info would ride into the prompt variables.
    it.each([
      { policy: { deviceAccess: { canUseDevice: false, reason: 'external-bot' } }, why: 'policy' },
      { plan: { execution: { kind: 'sandbox', target: 'sandbox' } }, why: 'plan' },
    ])('does not adopt a device the run may not use ($why)', async ({ plan, policy }) => {
      const state = {
        ...mockState,
        messages: [],
        origin: { agentId: 'agent-1', topicId: 'topic-1' },
        ...(plan && { plan }),
        ...(policy && { principal: { policy } }),
      };
      mockCoordinator.loadAgentState.mockResolvedValue(state);
      const dbMessages = buildPersistedToolChain('answer');
      dbMessages[0] = {
        ...dbMessages[0],
        pluginState: {
          metadata: {
            activeDeviceId: 'device-1',
            devicePlatform: 'darwin',
            deviceSystemInfo: { workingDirectory: '/Users/someone/secret' },
          },
        },
        role: 'tool',
      };
      (service as any).messageModel.query.mockResolvedValue(dbMessages);
      vi.spyOn((service as any).messageService, 'prepareUiMessages').mockResolvedValue([]);
      const step = vi.fn().mockImplementation(async (input) => ({
        events: [],
        newState: { ...input, stepCount: 2 },
        nextContext: mockParams.context,
      }));
      vi.spyOn(service as any, 'createAgentRuntime').mockResolvedValue({ runtime: { step } });

      const result = await service.executeStep(mockParams);

      expect(result.success).toBe(true);
      expect(step.mock.calls[0][0].binding?.device).toBeUndefined();
    });

    describe('activateDevice after a device is already bound', () => {
      const activation = (id: string, deviceId: string): UIChatMessage =>
        ({
          content: `Device "${deviceId}" activated successfully.`,
          createdAt: 3,
          id,
          pluginState: { metadata: { activeDeviceId: deviceId } },
          role: 'tool',
          updatedAt: 3,
        }) as UIChatMessage;

      const runStep = async (execution: Record<string, unknown>) => {
        const state = {
          ...mockState,
          binding: { device: { id: 'device-a' } },
          messages: [],
          origin: { agentId: 'agent-1', topicId: 'topic-1' },
          plan: { execution },
        };
        mockCoordinator.loadAgentState.mockResolvedValue(state);
        // The model activated device-a first, then device-b.
        (service as any).messageModel.query.mockResolvedValue([
          ...buildPersistedToolChain('answer'),
          activation('activate-a', 'device-a'),
          activation('activate-b', 'device-b'),
        ]);
        vi.spyOn((service as any).messageService, 'prepareUiMessages').mockResolvedValue([]);
        const step = vi.fn().mockImplementation(async (input) => ({
          events: [],
          newState: { ...input, stepCount: 2 },
          nextContext: mockParams.context,
        }));
        vi.spyOn(service as any, 'createAgentRuntime').mockResolvedValue({ runtime: { step } });

        const result = await service.executeStep(mockParams);
        expect(result.success).toBe(true);
        return step.mock.calls[0][0].binding?.device?.id;
      };

      it('follows the latest activation while the plan leaves the device open', async () => {
        const deviceId = await runStep({
          kind: 'device-unrouted',
          reason: 'ambiguous-online-devices',
          target: 'auto',
        });

        expect(deviceId).toBe('device-b');
      });

      it('keeps a locked run on its device even if history names another one', async () => {
        const deviceId = await runStep({ deviceId: 'device-a', kind: 'device', target: 'device' });

        expect(deviceId).toBe('device-a');
      });
    });

    it('shares one DB read while UI preparation is still pending', async () => {
      const state = {
        ...mockState,
        messages: [],
        origin: { agentId: 'agent-1', topicId: 'topic-1' },
      };
      mockCoordinator.loadAgentState.mockResolvedValue(state);
      const query = (service as any).messageModel.query.mockResolvedValue([]);
      let resolveUi!: (messages: []) => void;
      const uiRead = vi.spyOn((service as any).messageService, 'prepareUiMessages').mockReturnValue(
        new Promise((resolve) => {
          resolveUi = resolve;
        }),
      );
      const step = vi.fn().mockResolvedValue({
        events: [],
        newState: { ...state, stepCount: 2 },
        nextContext: mockParams.context,
      });
      vi.spyOn(service as any, 'createAgentRuntime').mockResolvedValue({ runtime: { step } });
      const running = service.executeStep(mockParams);
      let startedBeforeUiResolved: boolean;
      try {
        await vi.waitFor(() => expect(uiRead).toHaveBeenCalled());
        startedBeforeUiResolved = query.mock.calls.length > 0;
        expect(step).not.toHaveBeenCalled();
      } finally {
        resolveUi([]);
        await running;
      }
      expect(startedBeforeUiResolved).toBe(true);
      expect(query).toHaveBeenCalledTimes(1);
    });

    it('keeps ephemeral input while preparing the persisted UI snapshot', async () => {
      const messages = [{ role: 'user', content: 'transient prompt' }];
      const state = { ...mockState, messages, origin: { agentId: 'agent', topicId: 'topic' } };
      (service as any).messageModel.query.mockResolvedValue(
        buildPersistedToolChain('stored answer'),
      );
      const ui = [{ id: 'ui', role: 'assistant', content: 'UI answer' }];
      vi.spyOn((service as any).messageService, 'prepareUiMessages').mockResolvedValue(ui);

      const result = await (service as any).queryStepEntryMessages(state);

      expect(state.messages).toBe(messages);
      expect(result.uiMessages).toEqual(ui);
      expect(result.messages).toHaveLength(4);
    });

    it('hydrates the model even when UI preparation fails', async () => {
      const state = { ...mockState, messages: [], origin: { agentId: 'agent', topicId: 'topic' } };
      (service as any).messageModel.query.mockResolvedValue(
        buildPersistedToolChain('stored answer'),
      );
      vi.spyOn((service as any).messageService, 'prepareUiMessages').mockRejectedValue(
        new Error('UI failed'),
      );
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await (service as any).queryStepEntryMessages(state);

      expect(JSON.stringify(state.messages)).toContain('stored answer');
      expect(result.uiMessages).toBeUndefined();
      expect(result.messages).toHaveLength(4);
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
        data: { llmCalls: 0 },
      });

      expect(mockStreamManager.publishStreamEvent).toHaveBeenCalledWith('test-operation-1', {
        type: 'step_complete',
        stepIndex: 1,
        data: {
          stepIndex: 1,
          llmCalls: 0,
          nextStepScheduled: false, // Published before nextStepScheduled is updated
        },
      });

      expect(mockCoordinator.saveStepResult).toHaveBeenCalled();
      expect(mockQueueService.scheduleMessage).toHaveBeenCalled();
    });
  });
});

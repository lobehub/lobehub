/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '../../hooks';
import { type AgentExecutionParams } from '../../types';
import { AgentRuntimeService } from '..';
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
  const mockUserId = 'test-user-id';

  beforeEach(() => {
    ({ service, mockCoordinator, mockStreamManager } = setUpService(
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

    describe('frozen credential snapshot', () => {
      const frozen = {
        credentials: [{ key: 'OPENAI', name: 'OpenAI', type: 'apiKey' }],
        workspaceId: undefined,
      };

      /**
       * Snapshot the state AT the save, not the object afterwards: the runtime
       * keeps mutating `newState`, so a later clear would otherwise read back as
       * if it had been persisted.
       */
      const runStepWithToolCall = async (apiName: string) => {
        const stateWithSnapshot = { ...mockState, operationCredentials: frozen };
        mockCoordinator.loadAgentState.mockResolvedValue(stateWithSnapshot);

        let persisted: string | undefined;
        mockCoordinator.saveStepResult.mockImplementationOnce(async (_id: string, result: any) => {
          persisted = JSON.stringify(result.newState);
        });

        const mockRuntime = {
          step: vi.fn().mockResolvedValue({
            events: [],
            newState: { ...stateWithSnapshot, status: 'running', stepCount: 2 },
            nextContext: {
              payload: { toolCall: { apiName, identifier: 'lobe-creds' } },
              phase: 'tool_result',
            },
          }),
        };
        vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

        await service.executeStep(mockParams);

        expect(persisted).toBeDefined();
        return JSON.parse(persisted!);
      };

      it('drops the snapshot in the state it persists after the run saves a credential', async () => {
        const persistedState = await runStepWithToolCall('requestCredsInput');

        expect(persistedState.operationCredentials).toBeUndefined();
      });

      it('keeps the snapshot when the creds call only read', async () => {
        const persistedState = await runStepWithToolCall('injectCredsToSandbox');

        expect(persistedState.operationCredentials).toEqual({
          credentials: frozen.credentials,
        });
      });
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

    // Approving a callSubAgent starts a resume op that seeds its assistant
    // placeholder, runs the tool, then parks on the deferred sub-agent. The
    // resumed turn must fill that seed; a second assistant left the seed as an
    // empty "…" branch that hid the real answer.
    it('fills the seeded assistant placeholder when resuming from an async tool', async () => {
      const parkedState = {
        ...mockState,
        interruption: {
          canResume: true,
          interruptedAt: new Date().toISOString(),
          reason: 'async_tool',
        },
        pendingAssistantMessageId: 'seeded-assistant-1',
        pendingToolsCalling: [
          {
            apiName: 'callSubAgent',
            arguments: '{}',
            id: 'tool-call-1',
            identifier: 'lobe-agent',
            type: 'builtin',
          },
        ],
        status: 'waiting_for_async_tool',
      };
      const refreshedMessages = [
        { content: 'research', id: 'user-msg-1', role: 'user' },
        {
          id: 'assistant-msg-1',
          role: 'assistant',
          tools: [{ id: 'tool-call-1', result_msg_id: 'tool-msg-1' }],
        },
      ];
      const mockRuntime = {
        step: vi.fn().mockResolvedValue({
          events: [],
          newState: { ...parkedState, pendingToolsCalling: [], status: 'done', stepCount: 2 },
          nextContext: null,
        }),
      };

      mockCoordinator.loadAgentState.mockResolvedValue(parkedState);
      vi.spyOn(service as any, 'refreshMessagesFromDB').mockResolvedValue(refreshedMessages);
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });

      await service.executeStep({ ...mockParams, resumeAsyncTool: true });

      expect(mockRuntime.step).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          payload: { assistantMessageId: 'seeded-assistant-1', parentMessageId: 'tool-msg-1' },
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

      // Initial load returns running state; the post-step interrupt check
      // reads the sentinel instead of the state blob
      mockCoordinator.loadAgentState.mockResolvedValueOnce(mockState);
      mockCoordinator.isInterrupted.mockResolvedValueOnce(true);

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

    it('should detect an interruption written by an old worker without a sentinel', async () => {
      const mockStepResult = {
        events: [],
        newState: { ...mockState, status: 'running', stepCount: 2 },
        nextContext: mockParams.context,
      };

      const mockRuntime = { step: vi.fn().mockResolvedValue(mockStepResult) };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });
      mockCoordinator.loadAgentState
        .mockResolvedValueOnce(mockState)
        .mockResolvedValueOnce({ ...mockState, status: 'interrupted' });
      mockCoordinator.isInterrupted.mockResolvedValueOnce(false);

      const result = await service.executeStep(mockParams);

      expect(result.state).toEqual(expect.objectContaining({ status: 'interrupted' }));
      expect(result.nextStepScheduled).toBe(false);
      expect(mockCoordinator.loadAgentState).toHaveBeenCalledTimes(2);
      expect(mockCoordinator.saveStepResult).toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({
          newState: expect.objectContaining({ status: 'interrupted' }),
        }),
      );
    });

    it('should abort a long step when an old worker writes only interrupted state', async () => {
      vi.useFakeTimers();
      const mockStepResult = {
        events: [],
        newState: { ...mockState, status: 'running', stepCount: 2 },
        nextContext: mockParams.context,
      };

      try {
        vi.spyOn(service as any, 'createAgentRuntime').mockImplementation(function (
          ...args: unknown[]
        ) {
          const { abortSignal } = args[0] as { abortSignal: AbortSignal };
          return {
            runtime: {
              step: vi.fn(function () {
                return new Promise((resolve) => {
                  abortSignal.addEventListener('abort', () => resolve(mockStepResult), {
                    once: true,
                  });
                });
              }),
            },
          };
        });
        mockCoordinator.loadAgentState
          .mockResolvedValueOnce(mockState)
          .mockResolvedValue({ ...mockState, status: 'interrupted' });
        mockCoordinator.isInterrupted.mockResolvedValue(false);

        const execution = service.executeStep(mockParams);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(30_000);
        const result = await execution;

        expect(result.state).toEqual(expect.objectContaining({ status: 'interrupted' }));
        expect(result.nextStepScheduled).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should resolve pending client tools when interruption races the parked result', async () => {
      const completedTool = {
        apiName: 'calculate',
        arguments: '{}',
        id: 'completed-server-tool-call',
        identifier: 'server-tool',
        type: 'default' as const,
      };
      const pendingTool = {
        apiName: 'search',
        arguments: '{}',
        id: 'client-tool-call',
        identifier: 'client-tool',
        type: 'default' as const,
      };
      const parkedResult = {
        events: [{ type: 'interrupted' as const }],
        newState: {
          ...mockState,
          messages: [
            {
              content: 'Completed server result',
              role: 'tool' as const,
              tool_call_id: completedTool.id,
            },
          ],
          pendingToolsCalling: [pendingTool],
          status: 'waiting_for_async_tool' as const,
          stepCount: 2,
        },
        nextContext: undefined,
      };
      const resolvedResult = {
        events: [{ type: 'done' as const }],
        newState: {
          ...parkedResult.newState,
          messages: [
            ...parkedResult.newState.messages,
            {
              content: 'Tool execution was aborted by user.',
              role: 'tool' as const,
              tool_call_id: pendingTool.id,
            },
          ],
          status: 'done' as const,
        },
      };
      const mockRuntime = {
        step: vi.fn().mockResolvedValueOnce(parkedResult).mockResolvedValueOnce(resolvedResult),
      };
      vi.spyOn(service as any, 'createAgentRuntime').mockReturnValue({ runtime: mockRuntime });
      mockCoordinator.loadAgentState.mockResolvedValueOnce(mockState);
      mockCoordinator.isInterrupted.mockResolvedValueOnce(true);

      const mixedBatchContext = {
        ...mockParams.context!,
        payload: {
          ...(mockParams.context!.payload as Record<string, unknown>),
          hasToolsCalling: true,
          toolsCalling: [completedTool, pendingTool],
        },
        phase: 'llm_result' as const,
      };
      const result = await service.executeStep({ ...mockParams, context: mixedBatchContext });

      expect(result.state).toEqual(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: 'Completed server result',
              tool_call_id: completedTool.id,
            }),
            expect.objectContaining({ tool_call_id: pendingTool.id }),
          ]),
          status: 'interrupted',
        }),
      );
      expect(mockRuntime.step).toHaveBeenCalledTimes(2);
      expect(mockRuntime.step).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'interrupted' }),
        expect.objectContaining({
          payload: expect.objectContaining({ toolsCalling: [pendingTool] }),
          phase: 'llm_result',
        }),
      );
    });
  });
});

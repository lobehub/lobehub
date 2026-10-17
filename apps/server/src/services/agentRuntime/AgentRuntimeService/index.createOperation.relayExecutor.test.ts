/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';

import { hookDispatcher } from '../hooks';
import { type OperationCreationParams } from '../types';
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
  let mockQueueService: any;
  const mockUserId = 'test-user-id';

  beforeEach(() => {
    ({ service, mockCoordinator, mockQueueService } = setUpService(
      AgentRuntimeService,
      mockUserId,
    ));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AGENT_RUNTIME_BASE_URL;
    hookDispatcher.unregister('test-operation-1');
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

    describe('relay executor (host.llmExecutor)', () => {
      const executor = { capabilities: ['llm_relay@1'], clientId: 'tab-a', providers: ['ollama'] };
      // A parent run of the caller's own.
      const ownParent = (host: Record<string, unknown>) => ({
        host,
        origin: { userId: mockUserId },
      });

      it('stores the executor the client declared', async () => {
        await service.createOperation({ ...mockParams, autoStart: false, llmExecutor: executor });
        const savedState = mockCoordinator.saveAgentState.mock.calls[0][1];
        expect(savedState.host.llmExecutor).toEqual(executor);
      });

      it("lets a group member, mirrored onto its parent's channel, inherit the parent's executor", async () => {
        await mockCoordinator.saveAgentState('parent-op', ownParent({ llmExecutor: executor }));
        mockCoordinator.saveAgentState.mockClear();

        await service.createOperation({
          ...mockParams,
          appContext: { ...mockParams.appContext, orchestrationRole: 'member' },
          autoStart: false,
          parentOperationId: 'parent-op',
        });
        const savedState = mockCoordinator.saveAgentState.mock.calls[0][1];
        expect(savedState.host.llmExecutor).toEqual({
          ...executor,
          channelOperationId: 'parent-op',
        });
      });

      it("lets an independent sub-agent inherit the parent's executor, relaying on the parent's channel", async () => {
        await mockCoordinator.saveAgentState('parent-op', ownParent({ llmExecutor: executor }));
        mockCoordinator.saveAgentState.mockClear();

        await service.createOperation({
          ...mockParams,
          appContext: { ...mockParams.appContext, isSubAgent: true },
          autoStart: false,
          parentOperationId: 'parent-op',
        });
        const savedState = mockCoordinator.saveAgentState.mock.calls[0][1];
        // The tab only subscribes to the parked parent's channel, so the
        // child's `llm_execute` has to ride that one.
        expect(savedState.host.llmExecutor).toEqual({
          ...executor,
          channelOperationId: 'parent-op',
        });
      });

      it("keeps a nested child on the channel the executor's tab subscribed to", async () => {
        await mockCoordinator.saveAgentState(
          'parent-op',
          ownParent({ llmExecutor: { ...executor, channelOperationId: 'root-op' } }),
        );
        mockCoordinator.saveAgentState.mockClear();

        await service.createOperation({
          ...mockParams,
          appContext: { ...mockParams.appContext, isSubAgent: true },
          autoStart: false,
          parentOperationId: 'parent-op',
        });
        const savedState = mockCoordinator.saveAgentState.mock.calls[0][1];
        expect(savedState.host.llmExecutor).toEqual({
          ...executor,
          channelOperationId: 'root-op',
        });
      });

      it('relays on its own channel when the client declared the executor itself', async () => {
        await mockCoordinator.saveAgentState('parent-op', ownParent({ llmExecutor: executor }));
        mockCoordinator.saveAgentState.mockClear();

        const own = { ...executor, clientId: 'tab-b' };
        await service.createOperation({
          ...mockParams,
          appContext: { ...mockParams.appContext, isSubAgent: true },
          autoStart: false,
          llmExecutor: own,
          parentOperationId: 'parent-op',
        });
        const savedState = mockCoordinator.saveAgentState.mock.calls[0][1];
        expect(savedState.host.llmExecutor).toEqual(own);
      });

      it("does not inherit the executor of another user's run", async () => {
        // A client names `parentOperationId`; a foreign run's executor would
        // hand this child's LLM payload to that user's tab.
        await mockCoordinator.saveAgentState('foreign-op', {
          host: { llmExecutor: executor },
          origin: { userId: 'someone-else' },
        });
        mockCoordinator.saveAgentState.mockClear();

        await service.createOperation({
          ...mockParams,
          appContext: { ...mockParams.appContext, isSubAgent: true },
          autoStart: false,
          parentOperationId: 'foreign-op',
        });
        const savedState = mockCoordinator.saveAgentState.mock.calls[0][1];
        expect(savedState.host).not.toHaveProperty('llmExecutor');
      });

      it("does not inherit the executor of the user's run in another workspace", async () => {
        // The same user's run elsewhere relays with that workspace's providers.
        await mockCoordinator.saveAgentState('other-workspace-op', {
          host: { llmExecutor: executor },
          origin: { userId: mockUserId, workspaceId: 'ws-other' },
        });
        mockCoordinator.saveAgentState.mockClear();

        await service.createOperation({
          ...mockParams,
          appContext: { ...mockParams.appContext, isSubAgent: true },
          autoStart: false,
          parentOperationId: 'other-workspace-op',
        });
        const savedState = mockCoordinator.saveAgentState.mock.calls[0][1];
        expect(savedState.host).not.toHaveProperty('llmExecutor');
      });

      it('carries no executor for a run nobody declared one for', async () => {
        await service.createOperation({ ...mockParams, autoStart: false });
        const savedState = mockCoordinator.saveAgentState.mock.calls[0][1];
        expect(savedState.host).not.toHaveProperty('llmExecutor');
      });
    });

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
          modelRuntimeConfig: mockParams.modelRuntimeConfig,
          operationToolSet: expect.objectContaining({ manifestMap: {} }),
          origin: expect.objectContaining({ userId: mockParams.userId }),
          world: expect.objectContaining({ agent: mockParams.agentConfig }),
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

    it('freezes the builder editing target on the run origin', async () => {
      await service.createOperation({
        ...mockParams,
        appContext: {
          editingAgentId: 'agt_target',
          editingGroupId: 'grp_target',
          scope: 'agent_builder',
        },
      });

      const [, state] = mockCoordinator.saveAgentState.mock.calls[0];
      expect(state.origin).toMatchObject({
        editingAgentId: 'agt_target',
        editingGroupId: 'grp_target',
      });
    });

    it('records the approval mode as a run policy', async () => {
      await service.createOperation({
        ...mockParams,
        userInterventionConfig: { approvalMode: 'headless' },
      });

      const [, state] = mockCoordinator.saveAgentState.mock.calls[0];
      expect(state.principal.policy.userIntervention).toEqual({ approvalMode: 'headless' });
      // Mirrored at the top level for the rolling-deploy window: a worker on the
      // pre-slot build reads only that, and would park this headless run.
      expect(state.userInterventionConfig).toEqual({ approvalMode: 'headless' });
    });

    it('stores the run tool set once, on the operation slot', async () => {
      const manifestMap = { 'lobe-web-browsing': { identifier: 'lobe-web-browsing' } };

      await service.createOperation({
        ...mockParams,
        toolSet: {
          enabledToolIds: ['lobe-web-browsing'],
          executorMap: {},
          manifestMap,
          sourceMap: { 'lobe-web-browsing': 'builtin' },
          tools: [{ function: { name: 'search' }, type: 'function' }],
        } as unknown as OperationCreationParams['toolSet'],
      });

      const [, state] = mockCoordinator.saveAgentState.mock.calls[0];
      expect(state.operationToolSet.manifestMap).toEqual(manifestMap);
      // Manifests are the heaviest thing on the state and it is re-serialized at
      // every step, so the legacy top-level mirrors are not written any more.
      for (const mirror of ['toolExecutorMap', 'toolManifestMap', 'toolSourceMap', 'tools']) {
        expect(mirror in state).toBe(false);
      }
    });

    it('does not require durable storage for an environment-only result hook', async () => {
      vi.stubEnv('AGENT_HOOK_WEBHOOK_URL', 'https://hooks.example/environment');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_TOKEN', 'synthetic-test-token');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_EVENTS', 'afterToolCall');
      vi.stubEnv('AGENT_HOOK_WEBHOOK_RESPONSE_HANDLING', 'toolCall');
      vi.spyOn(AgentOperationModel.prototype, 'recordStart').mockRejectedValue(
        new Error('db down'),
      );

      await expect(service.createOperation(mockParams)).resolves.toBeDefined();
    });

    it('requires durable storage for a caller result hook', async () => {
      vi.spyOn(AgentOperationModel.prototype, 'recordStart').mockRejectedValue(
        new Error('db down'),
      );

      await expect(
        service.createOperation({
          ...mockParams,
          hooks: [
            {
              id: 'caller',
              type: 'afterToolCall',
              webhook: {
                url: 'https://hooks.example/caller',
                responseHandling: 'toolCall',
              },
            },
          ],
        }),
      ).rejects.toThrow('Failed to durably persist afterToolCall');
    });

    // Codex P1 on #20093: the member bridge lived only in the 2h runtime
    // snapshot, so a late approval continued the supervisor instead.
    it("keeps a durable copy of a group member's completion bridge on the row", async () => {
      const recordStart = vi
        .spyOn(AgentOperationModel.prototype, 'recordStart')
        .mockResolvedValue(undefined);
      const bridge = {
        anchorMessageId: 'msg-speak',
        expectedMembers: 1,
        groupToolMessageId: 'msg-speak',
        mode: 'in_group',
        onComplete: 'resume',
        parentOperationId: 'op-supervisor',
      };

      await service.createOperation({
        ...mockParams,
        hooks: [
          {
            handler: vi.fn(),
            id: 'group-member-bridge',
            type: 'onComplete',
            webhook: { body: bridge, url: '/api/agent/webhooks/group-member-callback' },
          },
        ],
      } as any);

      expect(recordStart.mock.calls[0][0].metadata).toMatchObject({ groupMemberBridge: bridge });
    });

    // Codex P2 on #20093: a transient start-row failure used to be swallowed,
    // so the member ran without the durable bridge its Stop / late approval need.
    it('refuses to start a group member whose bridge row could not be persisted', async () => {
      vi.spyOn(AgentOperationModel.prototype, 'recordStart').mockRejectedValue(
        new Error('db down'),
      );

      await expect(
        service.createOperation({
          ...mockParams,
          hooks: [
            {
              handler: vi.fn(),
              id: 'group-member-bridge',
              type: 'onComplete',
              webhook: {
                body: {
                  anchorMessageId: 'msg-speak',
                  expectedMembers: 1,
                  groupToolMessageId: 'msg-speak',
                  mode: 'in_group',
                  onComplete: 'resume',
                  parentOperationId: 'op-supervisor',
                },
                url: '/api/agent/webhooks/group-member-callback',
              },
            },
          ],
        } as any),
      ).rejects.toThrow('Failed to durably persist group member');
    });

    it('keeps the frozen model facts on the run state but out of durable storage', async () => {
      const recordStart = vi
        .spyOn(AgentOperationModel.prototype, 'recordStart')
        .mockResolvedValue(undefined);
      const modelFacts = {
        cards: [{ abilities: { vision: true }, id: 'gpt-4', providerId: 'openai' }],
        model: 'gpt-4',
        provider: 'openai',
      };

      await service.createOperation({
        ...mockParams,
        modelRuntimeConfig: { ...mockParams.modelRuntimeConfig, modelFacts },
      });

      // The steps read the snapshot back off the state.
      expect(mockCoordinator.saveAgentState).toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({
          modelRuntimeConfig: expect.objectContaining({ modelFacts }),
        }),
      );
      // The row that outlives the run, and the metadata copy, stay as small as
      // they were: both only ever surface model / provider.
      expect(recordStart.mock.calls[0][0].modelRuntimeConfig).toEqual({ model: 'gpt-4' });
      expect(mockCoordinator.createAgentOperation).toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({ modelRuntimeConfig: { model: 'gpt-4' } }),
      );
    });

    it('waits for dependent records before dispatch without losing the prepared context', async () => {
      let release!: () => void;
      const prepared = new Promise<void>((resolve) => {
        release = resolve;
      });
      const onOperationCreated = vi.fn<(operationId: string) => Promise<void>>(
        async () => prepared,
      );
      const initialContext = {
        ...mockParams.initialContext,
        payload: {
          assistantMessageId: 'repair-assistant',
          parentMessageId: 'verify-card',
        },
      } as OperationCreationParams['initialContext'];
      const creation = service.createOperation({
        ...mockParams,
        initialContext,
        onOperationCreated,
      });
      try {
        await vi.waitFor(() =>
          expect(onOperationCreated).toHaveBeenCalledWith(mockParams.operationId),
        );
        expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
      } finally {
        release();
      }
      await creation;
      expect(mockQueueService.scheduleMessage).toHaveBeenCalledWith(
        expect.objectContaining({ context: initialContext }),
      );
    });

    it('does not dispatch when dependent record preparation fails', async () => {
      await expect(
        service.createOperation({
          ...mockParams,
          onOperationCreated: async () => {
            throw new Error('Plan unavailable');
          },
        }),
      ).rejects.toThrow('Plan unavailable');
      expect(mockQueueService.scheduleMessage).not.toHaveBeenCalled();
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

    it('should place evalContext on the world snapshot when provided', async () => {
      mockQueueService.scheduleMessage.mockResolvedValueOnce('message-123');

      const evalContext = { envPrompt: 'You are in a test environment' };
      await service.createOperation({ ...mockParams, evalContext });

      expect(mockCoordinator.saveAgentState).toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({
          world: expect.objectContaining({ eval: evalContext }),
        }),
      );
    });

    it('should persist the system-message context on the world snapshot', async () => {
      mockQueueService.scheduleMessage.mockResolvedValueOnce('message-123');

      const projectInstructions = [{ content: 'Use bun.', source: 'AGENTS.md' }];
      const connectorOwnershipNote = 'Gmail runs on Alice’s account.';
      await service.createOperation({
        ...mockParams,
        connectorOwnershipNote,
        projectInstructions,
      });

      // Steps can be claimed by another worker, so anything the context engine
      // needs has to survive on the persisted operation state — in the typed
      // `world` slot, which is the only place the engine reads it from.
      expect(mockCoordinator.saveAgentState).toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({
          world: expect.objectContaining({ connectorOwnershipNote, projectInstructions }),
        }),
      );
    });

    it('should persist the operation expertise snapshot in runtime state', async () => {
      mockQueueService.scheduleMessage.mockResolvedValueOnce('message-123');
      const expertise = {
        contentHash: 'stable-hash',
        domains: [{ id: 'domain-1', lessonIds: ['lesson-1'] }],
        renderedContext: '<expertise>stable</expertise>',
        schemaVersion: 1,
      };

      await service.createOperation({
        ...mockParams,
        enableExpertise: true,
        expertise,
      });

      // What the model is told about the run lives on the world slot, with the
      // top-level mirror kept for pre-slot workers during a rolling deploy.
      expect(mockCoordinator.saveAgentState).toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({
          enableExpertise: true,
          expertise,
          world: expect.objectContaining({ enableExpertise: true, expertise }),
        }),
      );
    });

    it('should restore tools activated in a previous operation into initial state', async () => {
      const taskManifest = { identifier: 'lobe-task' } as any;
      const initialMessages = [
        {
          content: 'Successfully activated tools: lobe-task',
          id: 'tool-message-1',
          plugin: { apiName: 'activateTools', identifier: 'lobe-activator' },
          pluginState: { activatedTools: [{ identifier: 'lobe-task' }] },
          role: 'tool',
        },
      ] as any;

      await service.createOperation({
        ...mockParams,
        autoStart: false,
        initialMessages,
        initialStepCount: 3,
        toolSet: {
          ...mockParams.toolSet,
          activatableToolIds: ['lobe-task'],
          manifestMap: { 'lobe-task': taskManifest },
        },
      });

      expect(mockCoordinator.saveAgentState).toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({
          activatedStepTools: [
            {
              activatedAtStep: 3,
              id: 'lobe-task',
              manifest: taskManifest,
              source: 'discovery',
            },
          ],
        }),
      );
    });

    it('should not restore historical tools that current run gates reject', async () => {
      await service.createOperation({
        ...mockParams,
        autoStart: false,
        initialMessages: [
          {
            content: 'Successfully activated tools: lobe-task',
            id: 'tool-message-1',
            plugin: { apiName: 'activateTools', identifier: 'lobe-activator' },
            pluginState: { activatedTools: [{ identifier: 'lobe-task' }] },
            role: 'tool',
          },
        ] as any,
        toolSet: {
          ...mockParams.toolSet,
          // The broad discovery map may still contain the manifest in chat/custom
          // mode or for a model without function calling support.
          activatableToolIds: [],
          manifestMap: { 'lobe-task': { identifier: 'lobe-task' } as any },
        },
      });

      expect(mockCoordinator.saveAgentState).toHaveBeenCalledWith(
        'test-operation-1',
        expect.objectContaining({ activatedStepTools: undefined }),
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
});

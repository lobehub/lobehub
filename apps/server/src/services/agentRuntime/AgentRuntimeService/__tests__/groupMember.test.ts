/**
 * @vitest-environment node
 */
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hookDispatcher } from '../../hooks';
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
  const mockUserId = 'test-user-id';

  beforeEach(() => {
    ({ service, mockCoordinator } = setUpService(AgentRuntimeService, mockUserId));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AGENT_RUNTIME_BASE_URL;
    hookDispatcher.unregister('test-operation-1');
  });

  describe('completeGroupActionMember', () => {
    const memberState = {
      messages: [
        { content: 'question', role: 'user' },
        { content: 'final answer', role: 'assistant' },
      ],
      origin: { agentId: 'agent-a' },
      modelRuntimeConfig: { model: 'gpt-test' },
      status: 'done',
      usage: { llm: { tokens: { total: 42 } }, tools: { totalCalls: 2 } },
    };

    let updateToolMessage: ReturnType<typeof vi.fn>;
    let resumeSpy: MockInstance<AgentRuntimeService['tryResumeParentFromAsyncTool']>;

    beforeEach(() => {
      vi.spyOn((service as any).agentOperationModel, 'findById').mockResolvedValue({
        metadata: { _hooks: [] },
      });
      updateToolMessage = vi.fn().mockResolvedValue({ success: true });
      (service as any).messageModel.updateToolMessage = updateToolMessage;
      resumeSpy = vi.spyOn(service, 'tryResumeParentFromAsyncTool').mockResolvedValue(true);
    });

    // G-05 follow-through: a member that inherits manual approval parks on
    // `waiting_for_human`; that is a pause, not an answer, so the supervisor
    // must stay parked until the approval continuation reports back.
    it.each(['in_group', 'isolated'] as const)(
      'holds the supervisor while a %s member waits for approval',
      async (mode) => {
        const won = await service.completeGroupActionMember({
          anchorMessageId: 'grp-tool-1',
          expectedMembers: 1,
          finalState: { ...memberState, status: 'waiting_for_human' } as any,
          groupToolMessageId: 'grp-tool-1',
          mode,
          onComplete: 'resume',
          operationId: 'child-1',
          parentOperationId: 'parent-1',
          reason: 'waiting_for_human',
        });

        expect(won).toBe(false);
        expect(updateToolMessage).not.toHaveBeenCalled();
        expect(resumeSpy).not.toHaveBeenCalled();
      },
    );

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

    it('single isolated member: extracts the final answer from an assistantGroup', async () => {
      await service.completeGroupActionMember({
        anchorMessageId: 'grp-tool-1',
        expectedMembers: 1,
        finalState: {
          ...memberState,
          messages: [
            { content: 'question', role: 'user' },
            {
              children: [
                {
                  content: '',
                  id: 'assistant-tools',
                  tools: [
                    {
                      id: 'tool-call-1',
                      result: { content: 'tool result', id: 'tool-result-1' },
                    },
                  ],
                },
                { content: 'grouped member answer', id: 'assistant-final' },
              ],
              content: '',
              id: 'assistant-group',
              role: 'assistantGroup',
            },
          ],
        } as any,
        groupToolMessageId: 'grp-tool-1',
        mode: 'isolated',
        onComplete: 'resume',
        operationId: 'child-1',
        parentOperationId: 'parent-1',
        reason: 'done',
      });

      expect(updateToolMessage).toHaveBeenCalledWith(
        'grp-tool-1',
        expect.objectContaining({ content: 'grouped member answer' }),
      );
    });

    it('single isolated member: extracts serialized multimodal text after DB rehydration', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        ...memberState,
        messages: undefined,
      });
      (service as any).messageModel.query.mockResolvedValue(
        buildPersistedToolChain(
          JSON.stringify([
            { text: 'persisted member answer', type: 'text' },
            { image: 'https://example.com/image.png', type: 'image' },
          ]),
          { isMultimodal: true },
        ),
      );

      await service.completeGroupActionMember({
        anchorMessageId: 'grp-tool-1',
        expectedMembers: 1,
        groupToolMessageId: 'grp-tool-1',
        mode: 'isolated',
        onComplete: 'resume',
        operationId: 'child-1',
        parentOperationId: 'parent-1',
        reason: 'done',
      });

      expect(updateToolMessage).toHaveBeenCalledWith(
        'grp-tool-1',
        expect.objectContaining({ content: 'persisted member answer' }),
      );
    });

    // Regression: same as completeSubAgentBridge's hetero case — a
    // heterogeneous isolated member never populates the coordinator's
    // runtime state at all, so `loadAgentState` genuinely resolves `null`.
    // Recover the real answer from the member's own isolation thread instead
    // of falling through to the "no textual answer" stub.
    it('single isolated member: recovers the answer from the isolation thread when the coordinator has no state at all (hetero)', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue(null);
      (service as any).messageModel.query.mockResolvedValue(
        buildPersistedToolChain('hello from the CLI'),
      );

      await service.completeGroupActionMember({
        anchorMessageId: 'grp-tool-1',
        expectedMembers: 1,
        groupToolMessageId: 'grp-tool-1',
        mode: 'isolated',
        onComplete: 'resume',
        operationId: 'child-1',
        parentOperationId: 'parent-1',
        reason: 'done',
        threadId: 'thread-1',
      });

      expect((service as any).messageModel.query).toHaveBeenCalledWith(
        { threadId: 'thread-1' },
        { allowShareVisitor: true },
      );
      expect(updateToolMessage).toHaveBeenCalledWith(
        'grp-tool-1',
        expect.objectContaining({ content: 'hello from the CLI' }),
      );
    });

    // Mirrors completeSubAgentBridge's identical Codex-flagged regression:
    // the thread fallback must be gated on `!finalState`, not merely an
    // empty `lastAssistantContent` — a real finalState whose last turn is
    // legitimately textless must keep the stub, not risk a stale earlier
    // reply from the thread's own history.
    it('single isolated member: does not query the thread when a real finalState already says the final turn is textless', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        ...memberState,
        messages: undefined,
      });
      (service as any).messageModel.query.mockResolvedValue(
        buildPersistedToolChain(
          JSON.stringify([{ image: 'https://example.com/image.png', type: 'image' }]),
          { isMultimodal: true },
        ),
      );
      const threadFallbackSpy = vi.spyOn(service as any, 'resolveLastAssistantContentFromThread');

      await service.completeGroupActionMember({
        anchorMessageId: 'grp-tool-1',
        expectedMembers: 1,
        groupToolMessageId: 'grp-tool-1',
        mode: 'isolated',
        onComplete: 'resume',
        operationId: 'child-1',
        parentOperationId: 'parent-1',
        reason: 'done',
        threadId: 'thread-1',
      });

      expect(threadFallbackSpy).not.toHaveBeenCalled();
      expect(updateToolMessage).toHaveBeenCalledWith(
        'grp-tool-1',
        expect.objectContaining({ content: 'Agent member completed without a textual answer.' }),
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

    it('completes a multi-member empty-reason denial and retains it after callback replay', async () => {
      const privateContent = 'synthetic-private-member-answer';
      const defaultReason = 'Blocked by afterToolCall hook.';
      const anchors = [
        { id: 'anchor-0', content: '', state: {} },
        { id: 'anchor-1', content: '', state: {} },
      ];
      const group = { id: 'grp-tool-1', parentId: 'assistant', content: '', state: {} };
      const rows = [...anchors, group];
      (service as any).serverDB.query = {
        messages: { findMany: vi.fn(async () => anchors) },
        messagePlugins: { findFirst: vi.fn().mockResolvedValue({ state: {} }) },
      };
      (service as any).messageModel.findById = vi.fn(async (id) =>
        rows.find((row) => row.id === id),
      );
      (service as any).messageModel.findMessagePlugin = vi.fn(async (id) => ({
        id,
        toolCallId: 'group-call',
        identifier: 'lobe-group-management',
        apiName: 'executeAgentTasks',
        arguments: '{}',
      }));
      updateToolMessage.mockImplementation(async (id, value) => {
        const row = rows.find((row) => row.id === id)!;
        if (row.content && value.onlyIfEmpty) return { success: true, applied: false };
        row.content = value.content;
        row.state = value.pluginState;
        return { success: true, applied: true };
      });
      mockCoordinator.loadAgentState.mockResolvedValue({
        operationId: 'parent-1',
        stepCount: 1,
        status: 'waiting_for_async_tool',
        host: {
          hooks: [
            {
              id: 'after-control',
              type: 'afterToolCall',
              webhook: { url: 'https://hooks.example/control', responseHandling: 'toolCall' },
            },
          ],
        },
      });
      const fetchHook = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () => new Response(JSON.stringify({ decision: 'deny', reason: '' })),
        );
      const complete = (anchorMessageId: string) =>
        service.completeGroupActionMember({
          anchorMessageId,
          expectedMembers: 2,
          finalState: {
            ...memberState,
            messages: [{ role: 'assistant', content: privateContent }],
          } as any,
          groupToolMessageId: group.id,
          mode: 'isolated',
          onComplete: 'resume',
          operationId: `child-${anchorMessageId}`,
          parentOperationId: 'parent-1',
          reason: 'done',
        });
      try {
        expect(await complete('anchor-0')).toBe(false);
        expect(resumeSpy).not.toHaveBeenCalled();
        expect(await complete('anchor-1')).toBe(true);
        expect(resumeSpy).toHaveBeenCalledTimes(1);
        expect(fetchHook).toHaveBeenCalledTimes(3);
        expect(rows.every((row) => row.content === defaultReason)).toBe(true);
        expect(JSON.stringify(rows)).not.toContain(privateContent);

        mockCoordinator.loadAgentState.mockResolvedValue(null);
        await complete('anchor-0');
        expect(fetchHook).toHaveBeenCalledTimes(3);
        expect(rows.every((row) => row.content === defaultReason)).toBe(true);
        expect(JSON.stringify(rows)).not.toContain(privateContent);
      } finally {
        fetchHook.mockRestore();
      }
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

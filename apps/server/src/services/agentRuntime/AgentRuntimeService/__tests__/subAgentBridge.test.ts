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
      vi.spyOn((service as any).agentOperationModel, 'findById').mockResolvedValue({
        metadata: { _hooks: [] },
      });
      updateToolMessage = vi.fn().mockResolvedValue({ success: true });
      (service as any).messageModel.updateToolMessage = updateToolMessage;
      (service as any).messageModel.findMessagePlugin = vi.fn().mockResolvedValue(undefined);
      resumeSpy = vi.spyOn(service, 'tryResumeParentFromAsyncTool').mockResolvedValue(true);
    });

    it('backfills the tool message from finalState and resumes with scheduleVerifyOnHold', async () => {
      const won = await service.completeSubAgentBridge({
        ...bridgeParams,
        finalState: childState as any,
      });

      expect(won).toBe(true);
      expect(updateToolMessage).toHaveBeenCalledWith('tool-msg-1', {
        onlyIfEmpty: true,
        content: 'final answer',
        pluginError: null,
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

    it.each([
      {
        reason: 'The child result is restricted by policy.',
        expected: 'The child result is restricted by policy.',
      },
      { reason: '', expected: 'Blocked by afterToolCall hook.' },
    ])(
      'gates deferred output before backfill and parent resume, including callback replay, reason=$reason',
      async ({ reason, expected: denialReason }) => {
        const privateContent = 'synthetic-private-child-answer';
        const stored = {
          id: 'tool-msg-1',
          identifier: 'lobe-agent',
          apiName: 'callSubAgent',
          arguments: '{"instruction":"original"}',
          toolCallId: 'native-child',
          state: {},
        };
        (service as any).messageModel.findMessagePlugin = vi.fn(async () => stored);
        (service as any).messageModel.findById = vi
          .fn()
          .mockResolvedValue({ id: 'tool-msg-1', parentId: 'assistant' });
        const fetchHook = vi
          .spyOn(globalThis, 'fetch')
          .mockImplementation(
            async () => new Response(JSON.stringify({ decision: 'deny', reason })),
          );
        const hooks = [
          {
            id: 'after-control',
            type: 'afterToolCall',
            webhook: { url: 'https://hooks.example/control', responseHandling: 'toolCall' },
          },
        ];
        mockCoordinator.loadAgentState.mockResolvedValue({
          operationId: 'parent-op-1',
          stepCount: 3,
          host: { hooks },
        });
        updateToolMessage.mockImplementation(async (_id, value) => {
          if ((stored as any).content && value.onlyIfEmpty)
            return { success: true, applied: false };
          (stored as any).content = value.content;
          stored.state = value.pluginState;
          (service as any).messageModel.findById.mockResolvedValue({
            id: 'tool-msg-1',
            parentId: 'assistant',
            content: value.content,
          });
          return { success: true };
        });
        try {
          await service.completeSubAgentBridge({
            ...bridgeParams,
            finalState: {
              ...childState,
              messages: [{ role: 'assistant', content: privateContent }],
            } as any,
          });
          expect(JSON.parse(String(fetchHook.mock.calls[0][1]?.body))).toMatchObject({
            args: { instruction: 'original' },
            toolCallId: 'native-child',
            result: { content: expect.stringContaining(privateContent) },
          });
          expect(JSON.stringify(updateToolMessage.mock.calls)).not.toContain(privateContent);
          expect(updateToolMessage).toHaveBeenCalledWith(
            'tool-msg-1',
            expect.objectContaining({
              content: denialReason,
              pluginError: 'hook_denied',
              pluginState: expect.objectContaining({
                phase: 'afterToolCall',
                reason: denialReason,
                type: 'blocked',
              }),
              replacePluginState: true,
              onlyIfEmpty: true,
            }),
          );
          expect(resumeSpy).toHaveBeenCalledTimes(1);
          // A duplicate callback cannot restore the raw child answer after configuration removal.
          mockCoordinator.loadAgentState.mockResolvedValue(null);
          await service.completeSubAgentBridge({
            ...bridgeParams,
            finalState: {
              ...childState,
              messages: [{ role: 'assistant', content: privateContent }],
            } as any,
          });
          expect(fetchHook).toHaveBeenCalledTimes(1);
          expect((stored as any).content).toBe(denialReason);
          expect(stored.state).toMatchObject({ reason: denialReason, type: 'blocked' });
          expect(JSON.stringify(stored.state)).not.toContain(privateContent);
        } finally {
          fetchHook.mockRestore();
        }
      },
    );

    it('ends a callSubAgent result with the sub-agent id so the parent can continue it', async () => {
      (service as any).messageModel.findMessagePlugin = vi
        .fn()
        .mockResolvedValue({ apiName: 'callSubAgent', identifier: 'lobe-agent' });

      await service.completeSubAgentBridge({ ...bridgeParams, finalState: childState as any });
      await service.completeSubAgentBridge({
        ...bridgeParams,
        finalState: { ...childState, error: { message: 'Budget exceeded' } } as any,
        reason: 'error',
      });

      expect(updateToolMessage).toHaveBeenNthCalledWith(
        1,
        'tool-msg-1',
        expect.objectContaining({ content: 'final answer\n\n<sub_agent id="thread-1" />' }),
      );
      expect(updateToolMessage).toHaveBeenNthCalledWith(
        2,
        'tool-msg-1',
        expect.objectContaining({
          content: expect.stringMatching(
            /^Sub-agent did not complete \(error\): .*\n\n<sub_agent id="thread-1" \/>$/,
          ),
        }),
      );
    });

    it('leaves callAgent results without a sub-agent id', async () => {
      (service as any).messageModel.findMessagePlugin = vi
        .fn()
        .mockResolvedValue({ apiName: 'callAgent', identifier: 'lobe-agent-management' });

      await service.completeSubAgentBridge({ ...bridgeParams, finalState: childState as any });

      expect(updateToolMessage).toHaveBeenCalledWith(
        'tool-msg-1',
        expect.objectContaining({ content: 'final answer' }),
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

    // Regression: a heterogeneous (CLI-driven) child never populates the
    // coordinator's Redis-backed runtime state at all — `loadAgentState`
    // genuinely resolves `null` for it, unlike the standard-runtime case
    // above where it resolves a real (if message-stripped) state object.
    // Without a thread-scoped fallback this always fell through to "Sub-agent
    // completed without a textual answer.", even though the CLI produced a
    // real reply — because the webhook's `eventFields` deliberately excludes
    // `lastAssistantContent` (see `createSubAgentBridgeHook`) and hetero never
    // writes into the coordinator, so nothing else could ever supply it.
    it('recovers the answer from the isolation thread when the coordinator has no state at all (hetero)', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue(null);
      (service as any).messageModel.query.mockResolvedValue(
        buildPersistedToolChain('hello from the CLI'),
      );

      await service.completeSubAgentBridge(bridgeParams);

      expect((service as any).messageModel.query).toHaveBeenCalledWith(
        { threadId: 'thread-1' },
        { allowShareVisitor: true },
      );
      expect(updateToolMessage).toHaveBeenCalledWith(
        'tool-msg-1',
        expect.objectContaining({ content: 'hello from the CLI' }),
      );
    });

    it('extracts a grouped final answer after webhook state is rehydrated from the DB', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        ...childState,
        messages: undefined,
      });
      (service as any).messageModel.query.mockResolvedValue(
        buildPersistedToolChain('final answer after tool use'),
      );

      await service.completeSubAgentBridge(bridgeParams);

      expect(updateToolMessage).toHaveBeenCalledWith(
        'tool-msg-1',
        expect.objectContaining({ content: 'final answer after tool use' }),
      );
    });

    it('extracts text from serialized multimodal content after DB query and group parsing', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        ...childState,
        messages: undefined,
      });
      (service as any).messageModel.query.mockResolvedValue(
        buildPersistedToolChain(
          JSON.stringify([
            { text: 'persisted multimodal answer', type: 'text' },
            { image: 'https://example.com/image.png', type: 'image' },
          ]),
          { isMultimodal: true },
        ),
      );

      await service.completeSubAgentBridge(bridgeParams);

      expect(updateToolMessage).toHaveBeenCalledWith(
        'tool-msg-1',
        expect.objectContaining({ content: 'persisted multimodal answer' }),
      );
    });

    it('uses the no-text fallback for an image-only serialized final assistant', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        ...childState,
        messages: undefined,
      });
      (service as any).messageModel.query.mockResolvedValue(
        buildPersistedToolChain(
          JSON.stringify([{ image: 'https://example.com/image.png', type: 'image' }]),
          { isMultimodal: true },
        ),
      );

      await service.completeSubAgentBridge(bridgeParams);

      expect(updateToolMessage).toHaveBeenCalledWith(
        'tool-msg-1',
        expect.objectContaining({ content: 'Sub-agent completed without a textual answer.' }),
      );
    });

    // Regression for a Codex review finding on the thread-fallback above: it
    // must be gated on `!finalState` (no authoritative state at all — the
    // heterogeneous case), not merely an empty `lastAssistantContent`.
    // Otherwise a REAL, authoritative finalState whose last turn is
    // legitimately textless would still trigger the thread re-query, and a
    // lagging read that surfaces an EARLIER real reply from the same thread
    // would silently show stale text instead of the correct empty-answer
    // stub.
    it('does not query the thread when a real finalState already says the final turn is textless', async () => {
      mockCoordinator.loadAgentState.mockResolvedValue({
        ...childState,
        messages: undefined,
      });
      (service as any).messageModel.query.mockResolvedValue(
        buildPersistedToolChain(
          JSON.stringify([{ image: 'https://example.com/image.png', type: 'image' }]),
          { isMultimodal: true },
        ),
      );
      const threadFallbackSpy = vi.spyOn(service as any, 'resolveLastAssistantContentFromThread');

      await service.completeSubAgentBridge(bridgeParams);

      expect(threadFallbackSpy).not.toHaveBeenCalled();
      expect(updateToolMessage).toHaveBeenCalledWith(
        'tool-msg-1',
        expect.objectContaining({ content: 'Sub-agent completed without a textual answer.' }),
      );
    });

    it('extracts text parts from the grouped final assistant content', async () => {
      await service.completeSubAgentBridge({
        ...bridgeParams,
        finalState: {
          ...childState,
          messages: [
            {
              children: [
                {
                  content: [
                    { text: 'final answer', type: 'text' },
                    { image_url: { url: 'https://example.com/image.png' }, type: 'image_url' },
                  ],
                  id: 'assistant-final',
                },
              ],
              content: '',
              id: 'assistant-group',
              role: 'assistantGroup',
            },
          ],
        } as any,
      });

      expect(updateToolMessage).toHaveBeenCalledWith(
        'tool-msg-1',
        expect.objectContaining({ content: 'final answer' }),
      );
    });

    it('does not fall back to stale text when the grouped final assistant is empty', async () => {
      await service.completeSubAgentBridge({
        ...bridgeParams,
        finalState: {
          ...childState,
          messages: [
            { content: 'stale answer', id: 'assistant-stale', role: 'assistant' },
            { content: 'follow-up', id: 'user-follow-up', role: 'user' },
            {
              children: [{ content: '', id: 'assistant-final' }],
              content: '',
              id: 'assistant-group',
              role: 'assistantGroup',
            },
          ],
        } as any,
      });

      expect(updateToolMessage).toHaveBeenCalledWith(
        'tool-msg-1',
        expect.objectContaining({ content: 'Sub-agent completed without a textual answer.' }),
      );
    });

    it('writes an error note + pluginError when the child failed, surfacing the real reason', async () => {
      // The parent agent's LLM only sees `content`; without the inlined reason it
      // gets the opaque generic note and cannot tell why the dispatch failed
      // (issue #16257). The structured error still rides on pluginError.
      await service.completeSubAgentBridge({
        ...bridgeParams,
        finalState: { ...childState, error: { message: 'boom' } } as any,
        reason: 'error',
      });

      expect(updateToolMessage).toHaveBeenCalledWith(
        'tool-msg-1',
        expect.objectContaining({
          content: 'Sub-agent did not complete (error): boom',
          pluginError: { message: 'boom' },
          pluginState: expect.objectContaining({ status: 'error' }),
        }),
      );
    });

    it('falls back to the generic note when the failed child has no error detail', async () => {
      await service.completeSubAgentBridge({
        ...bridgeParams,
        finalState: { ...childState, error: undefined } as any,
        reason: 'error',
      });

      expect(updateToolMessage).toHaveBeenCalledWith(
        'tool-msg-1',
        expect.objectContaining({
          content: 'Sub-agent did not complete (error).',
          pluginState: expect.objectContaining({ status: 'error' }),
        }),
      );
    });

    // A watchdog-abandoned child's reloaded state has no error; the abandon
    // hand-off passes it explicitly. Without it the parent got a bare "(error).".
    it('explains a watchdog-abandoned child from the hand-off error message', async () => {
      await service.completeSubAgentBridge({
        ...bridgeParams,
        errorMessage: 'Operation abandoned: inactivity_watchdog',
        finalState: { ...childState, error: undefined } as any,
        reason: 'error',
      });

      const call = updateToolMessage.mock.calls.at(-1)?.[1];
      expect(call.content).toBe(
        'Sub-agent did not complete (error): the sub-agent stopped making progress and the platform ended it (inactivity_watchdog). ' +
          'Anything it already did (searches, pages read, documents written) is kept in its thread.',
      );
      expect(call.pluginError).toEqual({ message: 'Operation abandoned: inactivity_watchdog' });
    });

    // "Budget exceeded" alone reads like a per-sub-agent allowance, so parents
    // retried or fanned out more sub-agents against the same exhausted limit.
    describe('billing-limit failures', () => {
      const budgetError = (type: string, budgetTypeAtError?: string) => ({
        body: {
          budget: {
            availableCredits: 24_659,
            budgetTypeAtError,
            requiredCredits: 50_638,
          },
          message: 'Budget exceeded',
        },
        message: 'Budget exceeded',
        type,
      });
      const bridgeContent = async (error: unknown) => {
        await service.completeSubAgentBridge({
          ...bridgeParams,
          finalState: { ...childState, error } as any,
          reason: 'error',
        });
        return updateToolMessage.mock.calls.at(-1)?.[1];
      };

      it('explains a personal credit shortfall without quoting the balance', async () => {
        const error = budgetError('InsufficientBudgetForModel', 'subscription');
        const call = await bridgeContent(error);

        expect(call.content).toBe(
          'Sub-agent did not complete (error): stopped by a LobeHub billing limit (InsufficientBudgetForModel): ' +
            "the account's LobeHub credits are too low for this model; the account owner has to top up or upgrade. " +
            'This limit is shared by every sub-agent and by this conversation, so retrying or dispatching more sub-agents on the same model will not get past it; ' +
            'a sub-agent that runs on a less expensive model may still fit. ' +
            'Otherwise finish with what you already have and tell the user about the limit.',
        );
        expect(call.content).not.toMatch(/24659|24,659|50638/);
        expect(call.pluginError).toEqual(error);
      });

      it.each([
        [
          'workspace',
          "the workspace's shared LobeHub credits can't cover this model's estimated cost",
        ],
        [
          'workspace_member',
          "this member's workspace credit allowance can't cover this model's estimated cost",
        ],
      ])('names the %s allowance as the one to raise', async (scope, expected) => {
        const call = await bridgeContent(budgetError('InsufficientBudgetForModel', scope));

        expect(call.content).toContain(expected);
        expect(call.content).not.toContain('top up');
      });

      it('points plan-limit failures at the plan, not at credits', async () => {
        const call = await bridgeContent(budgetError('SubscriptionPlanLimit', 'subscription'));

        expect(call.content).toContain(
          'plan limit was reached or the plan does not cover this model',
        );
      });

      // InsufficientBudgetForModel still leaves credits in the allowance, so a
      // cheaper model can fit; only an exhausted plan makes every dispatch futile.
      it('keeps the cheaper-model path open for a model-cost shortfall only', async () => {
        const shortfall = await bridgeContent(
          budgetError('InsufficientBudgetForModel', 'workspace_member'),
        );
        expect(shortfall.content).toContain('on the same model will not get past it');
        expect(shortfall.content).toContain('less expensive model may still fit');

        const exhausted = await bridgeContent(budgetError('FreePlanLimit', 'workspace'));
        expect(exhausted.content).toContain("the workspace's shared LobeHub credits are used up");
        expect(exhausted.content).toContain('more sub-agents will not get past it');
        expect(exhausted.content).not.toContain('less expensive model');
      });
    });

    it('truncates an oversized child error so it cannot bloat the parent context', async () => {
      const huge = 'x'.repeat(500);
      await service.completeSubAgentBridge({
        ...bridgeParams,
        finalState: { ...childState, error: { message: huge } } as any,
        reason: 'error',
      });

      const call = updateToolMessage.mock.calls.at(-1)?.[1];
      expect(call.content).toBe(`Sub-agent did not complete (error): ${'x'.repeat(300)}…`);
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

    describe('background sub-agent', () => {
      let deliver: ReturnType<typeof vi.fn>;

      beforeEach(() => {
        (service as any).messageModel.findMessagePlugin = vi.fn().mockResolvedValue({
          apiName: 'callSubAgent',
          identifier: 'lobe-agent',
          state: { background: true, status: 'pending' },
        });
        (service as any).messageModel.findById = vi
          .fn()
          .mockResolvedValue({ id: 'tool-msg-1', topicId: 'topic-1' });
        deliver = vi.fn().mockResolvedValue(undefined);
        (service as any).delegate.deliverBackgroundSubAgentResults = deliver;
      });

      it('keeps the start receipt, stores the answer and delivers instead of resuming', async () => {
        const won = await service.completeSubAgentBridge({
          ...bridgeParams,
          finalState: childState as any,
        });

        expect(won).toBe(false);
        // No `content`: the tool result stays the receipt the parent already read.
        expect(updateToolMessage).toHaveBeenCalledWith('tool-msg-1', {
          pluginError: undefined,
          pluginState: {
            model: 'gpt-test',
            result: 'final answer',
            status: 'completed',
            threadId: 'thread-1',
            totalCost: undefined,
            totalInputTokens: undefined,
            totalOutputTokens: undefined,
            totalToolCalls: 2,
            totalTokens: 42,
          },
        });
        expect(resumeSpy).not.toHaveBeenCalled();
        expect(deliver).toHaveBeenCalledWith({ topicId: 'topic-1' });
      });

      it('stores a failure as an error result', async () => {
        await service.completeSubAgentBridge({
          ...bridgeParams,
          finalState: { ...childState, error: { message: 'Budget exceeded' } } as any,
          reason: 'error',
        });

        const [, update] = updateToolMessage.mock.calls[0];
        expect(update.pluginState).toMatchObject({ status: 'error' });
        expect(update.pluginState.result).toContain('Budget exceeded');
        expect(update.pluginError).toBeDefined();
        expect(deliver).toHaveBeenCalled();
      });

      it('gates the finished answer through afterToolCall before storing and delivering it', async () => {
        // The answer never returns through ServerToolTransport: the delivery
        // below publishes it into the parent conversation, so the controls have
        // to be applied to the stored result — not only to the start receipt.
        const privateContent = 'synthetic-private-background-answer';
        const denialReason = 'The child result is restricted by policy.';
        const stored: any = {
          apiName: 'callSubAgent',
          arguments: '{"instruction":"original"}',
          id: 'tool-msg-1',
          identifier: 'lobe-agent',
          state: { background: true, status: 'pending' },
          toolCallId: 'native-child',
        };
        (service as any).messageModel.findMessagePlugin = vi.fn(async () => stored);
        (service as any).messageModel.findById = vi
          .fn()
          .mockResolvedValue({ id: 'tool-msg-1', parentId: 'assistant', topicId: 'topic-1' });
        const fetchHook = vi
          .spyOn(globalThis, 'fetch')
          .mockImplementation(
            async () => new Response(JSON.stringify({ decision: 'deny', reason: denialReason })),
          );
        mockCoordinator.loadAgentState.mockResolvedValue({
          operationId: 'parent-op-1',
          stepCount: 3,
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

        try {
          const won = await service.completeSubAgentBridge({
            ...bridgeParams,
            finalState: {
              ...childState,
              messages: [{ content: privateContent, role: 'assistant' }],
            } as any,
          });

          expect(won).toBe(false);
          expect(JSON.parse(String(fetchHook.mock.calls[0][1]?.body))).toMatchObject({
            result: { content: expect.stringContaining(privateContent) },
          });
          // The denied answer must not reach the placeholder the delivery reads.
          expect(JSON.stringify(updateToolMessage.mock.calls)).not.toContain(privateContent);
          expect(updateToolMessage).toHaveBeenCalledWith('tool-msg-1', {
            pluginError: 'hook_denied',
            pluginState: expect.objectContaining({ result: denialReason, status: 'error' }),
          });
          expect(deliver).toHaveBeenCalledWith({ topicId: 'topic-1' });
        } finally {
          fetchHook.mockRestore();
        }
      });

      it('throws when the answer cannot be stored, so the callback is redelivered', async () => {
        updateToolMessage.mockResolvedValue({ success: false });

        await expect(
          service.completeSubAgentBridge({ ...bridgeParams, finalState: childState as any }),
        ).rejects.toThrow(/failed to record the result/);
        expect(deliver).not.toHaveBeenCalled();
      });
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
});

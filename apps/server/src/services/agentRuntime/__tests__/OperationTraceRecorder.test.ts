// @vitest-environment node
import { resolveContextEngineSteps } from '@lobechat/agent-tracing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OperationTraceRecorder } from '../OperationTraceRecorder';
import type { StepPresentationData } from '../types';

const buildStore = () => ({
  get: vi.fn(),
  getLatest: vi.fn(),
  list: vi.fn(),
  listPartials: vi.fn(),
  loadPartial: vi.fn(),
  removePartial: vi.fn().mockResolvedValue(undefined),
  save: vi.fn().mockResolvedValue(undefined),
  savePartial: vi.fn().mockResolvedValue(undefined),
});

const buildPresentation = (overrides: Partial<StepPresentationData> = {}): StepPresentationData =>
  ({
    content: 'hello',
    executionTimeMs: 100,
    reasoning: undefined,
    stepType: 'call_llm' as const,
    thinking: false,
    toolsCalling: undefined,
    toolsResult: undefined,
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalSteps: 1,
    totalTokens: 100,
    ...overrides,
  }) as StepPresentationData;

describe('OperationTraceRecorder', () => {
  describe('appendStep', () => {
    let store: ReturnType<typeof buildStore>;
    let recorder: OperationTraceRecorder;

    beforeEach(() => {
      store = buildStore();
      recorder = new OperationTraceRecorder(store as any);
    });

    it('initializes the partial header (model + provider + startedAt) on the first append', async () => {
      store.loadPartial.mockResolvedValue(null);

      await recorder.appendStep('op-1', {
        afterStepSignalEvents: [],
        agentState: {
          messages: [],
          world: { agent: { model: 'claude-sonnet-4-6', provider: 'lobehub' } },
        },
        beforeStepSignalEvents: [],
        currentContext: { phase: 'user_input' },
        externalRetryCount: 0,
        presentation: buildPresentation(),
        startedAt: 1_777_960_000_000,
        stepIndex: 0,
        stepResult: { events: [], newState: { activatedStepTools: [], messages: [] } },
      });

      const saved = store.savePartial.mock.calls[0][1];
      expect(saved.model).toBe('claude-sonnet-4-6');
      expect(saved.provider).toBe('lobehub');
      expect(typeof saved.startedAt).toBe('number');
      expect(saved.steps).toHaveLength(1);
    });

    it('strips llm_stream events and prunes finalState on done events', async () => {
      store.loadPartial.mockResolvedValue({ startedAt: 1, steps: [] });

      const events = [
        { type: 'llm_stream', chunk: 'noise' },
        { type: 'tool_result', id: 'tc-1' },
        {
          finalState: {
            activatedStepTools: [{ id: 'kept' }],
            expertise: {
              contentHash: 'hash',
              domains: [{ id: 'product-design', lessonIds: ['lesson-1'] }],
              renderedContext: '<expertise>heavy learned context</expertise>',
              schemaVersion: 1,
            },
            messages: ['heavy'],
            operationToolSet: { manifestMap: {} },
            otherStateField: 'kept',
            toolManifestMap: {},
            toolSourceMap: {},
            tools: [],
            world: {
              agent: { systemRole: 'kept' },
              expertise: { contentHash: 'hash', renderedContext: '<expertise/>' },
            },
          },
          reason: 'done',
          type: 'done',
        },
      ];

      await recorder.appendStep('op-2', {
        afterStepSignalEvents: [],
        agentState: { messages: [] },
        beforeStepSignalEvents: [],
        currentContext: { phase: 'tool_result' },
        externalRetryCount: 0,
        presentation: buildPresentation(),
        startedAt: 100,
        stepIndex: 1,
        stepResult: { events, newState: { activatedStepTools: [], messages: [] } },
      });

      const step = store.savePartial.mock.calls[0][1].steps[0];
      const eventTypes = step.events.map((e: any) => e.type);
      expect(eventTypes).not.toContain('llm_stream');
      expect(eventTypes).toContain('done');

      const doneEvent = step.events.find((e: any) => e.type === 'done');
      expect(doneEvent.finalState.activatedStepTools).toEqual([{ id: 'kept' }]);
      expect(doneEvent.finalState.otherStateField).toBe('kept');
      expect(doneEvent.finalState.expertise).toBeUndefined();
      expect(doneEvent.finalState.messages).toBeUndefined();
      expect(doneEvent.finalState.operationToolSet).toBeUndefined();
      expect(doneEvent.finalState.toolManifestMap).toBeUndefined();
      expect(doneEvent.finalState.toolSourceMap).toBeUndefined();
      expect(doneEvent.finalState.tools).toBeUndefined();
      // Only the expertise snapshot leaves `world`; the rest of it is kept.
      expect(doneEvent.finalState.world).toEqual({ agent: { systemRole: 'kept' } });
    });

    it('emits messagesDelta-only beyond step 0 and only stores messagesBaseline when isCompression', async () => {
      store.loadPartial.mockResolvedValue({ startedAt: 1, steps: [] });

      const prevMessages = [{ role: 'user' }, { role: 'assistant' }];
      const afterMessages = [...prevMessages, { role: 'tool' }];

      await recorder.appendStep('op-3', {
        afterStepSignalEvents: [],
        agentState: { messages: prevMessages },
        beforeStepSignalEvents: [],
        currentContext: { phase: 'tool_result' },
        externalRetryCount: 0,
        presentation: buildPresentation({ stepType: 'call_tool' }),
        startedAt: 200,
        stepIndex: 5,
        stepResult: { events: [], newState: { activatedStepTools: [], messages: afterMessages } },
      });

      const step = store.savePartial.mock.calls[0][1].steps[0];
      expect(step.messagesDelta).toEqual([{ role: 'tool' }]);
      expect(step.messagesBaseline).toBeUndefined();
      expect(step.isCompressionReset).toBeUndefined();
    });

    it('marks compression resets and persists messagesBaseline at the reset point', async () => {
      store.loadPartial.mockResolvedValue({ startedAt: 1, steps: [] });

      const prevMessages = [{ role: 'user' }];
      const afterMessages = [{ role: 'system', summary: true }, { role: 'user' }];

      await recorder.appendStep('op-4', {
        afterStepSignalEvents: [],
        agentState: { messages: prevMessages },
        beforeStepSignalEvents: [],
        currentContext: { phase: 'user_input' },
        externalRetryCount: 0,
        presentation: buildPresentation(),
        startedAt: 300,
        stepIndex: 7,
        stepResult: {
          events: [{ type: 'compression_complete' }],
          newState: { activatedStepTools: [], messages: afterMessages },
        },
      });

      const step = store.savePartial.mock.calls[0][1].steps[0];
      expect(step.isCompressionReset).toBe(true);
      expect(step.messagesBaseline).toEqual(prevMessages);
    });

    it('records activatedStepToolsDelta when new tools are activated mid-step', async () => {
      store.loadPartial.mockResolvedValue({ startedAt: 1, steps: [] });

      await recorder.appendStep('op-5', {
        afterStepSignalEvents: [],
        agentState: { activatedStepTools: [{ id: 'a' }], messages: [] },
        beforeStepSignalEvents: [],
        currentContext: { phase: 'tool_result' },
        externalRetryCount: 0,
        presentation: buildPresentation({ stepType: 'call_tool' }),
        startedAt: 400,
        stepIndex: 2,
        stepResult: {
          events: [],
          newState: { activatedStepTools: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], messages: [] },
        },
      });

      const step = store.savePartial.mock.calls[0][1].steps[0];
      expect(step.activatedStepToolsDelta).toEqual([{ id: 'b' }, { id: 'c' }]);
    });

    it('stores per-step usage on each step instead of cumulative operation totals', async () => {
      store.loadPartial.mockResolvedValue({ startedAt: 1, steps: [] });

      await recorder.appendStep('op-usage', {
        afterStepSignalEvents: [],
        agentState: { messages: [] },
        beforeStepSignalEvents: [],
        currentContext: { phase: 'user_input' },
        externalRetryCount: 0,
        presentation: buildPresentation({
          stepCost: 0.02,
          stepInputTokens: 30,
          stepOutputTokens: 20,
          stepTotalTokens: 50,
          totalCost: 0.12,
          totalInputTokens: 300,
          totalOutputTokens: 200,
          totalTokens: 500,
        }),
        startedAt: 500,
        stepIndex: 3,
        stepResult: { events: [], newState: { activatedStepTools: [], messages: [] } },
      });

      const step = store.savePartial.mock.calls[0][1].steps[0];
      expect(step.inputTokens).toBe(30);
      expect(step.outputTokens).toBe(20);
      expect(step.totalCost).toBe(0.02);
      expect(step.totalTokens).toBe(50);
    });
  });

  describe('finalize', () => {
    let store: ReturnType<typeof buildStore>;
    let recorder: OperationTraceRecorder;

    beforeEach(() => {
      store = buildStore();
      recorder = new OperationTraceRecorder(store as any);
    });

    it('writes the canonical snapshot and removes the partial on success', async () => {
      store.loadPartial.mockResolvedValue({
        model: 'claude-sonnet-4-6',
        provider: 'lobehub',
        startedAt: 1000,
        steps: [
          {
            completedAt: 1100,
            executionTimeMs: 100,
            startedAt: 1000,
            stepIndex: 0,
            stepType: 'call_llm',
            totalCost: 0,
            totalTokens: 50,
          },
        ],
      });

      await recorder.finalize('op-done', {
        completionReason: 'done',
        state: {
          cost: { total: 0.5 },
          origin: { agentId: 'agt-1', topicId: 'tpc-1', userId: 'u-1' },
          stepCount: 1,
          usage: { llm: { tokens: { total: 200 } } },
        },
      });

      expect(store.save).toHaveBeenCalledTimes(1);
      const saved = store.save.mock.calls[0][0];
      expect(saved).toMatchObject({
        agentId: 'agt-1',
        completionReason: 'done',
        operationId: 'op-done',
        topicId: 'tpc-1',
        totalCost: 0.5,
        totalSteps: 1,
        totalTokens: 200,
        userId: 'u-1',
      });
      expect(store.removePartial).toHaveBeenCalledWith('op-done');
    });

    it('appends a synthetic failed step when called from the error path', async () => {
      store.loadPartial.mockResolvedValue({
        startedAt: 1000,
        steps: [{ stepIndex: 0, stepType: 'call_llm' }],
      });

      await recorder.finalize('op-err', {
        completionReason: 'error',
        error: { message: 'parent missing', type: 'ConversationParentMissing' },
        failedStep: { startedAt: 5000, stepIndex: 1 },
        state: { cost: { total: 0 }, metadata: {}, usage: { llm: { tokens: { total: 100 } } } },
      });

      const saved = store.save.mock.calls[0][0];
      const failed = saved.steps.find((s: any) => s.stepIndex === 1);
      expect(failed).toBeDefined();
      expect(failed.stepType).toBe('call_tool');
      expect(failed.events?.[0]).toMatchObject({
        error: { message: 'parent missing', type: 'ConversationParentMissing' },
        type: 'error',
      });
      expect(saved.error).toMatchObject({ type: 'ConversationParentMissing' });
      expect(saved.completionReason).toBe('error');
    });

    it('preserves failed LLM step type and structured error body diagnostics', async () => {
      store.loadPartial.mockResolvedValue({
        startedAt: 1000,
        steps: [{ stepIndex: 0, stepType: 'call_tool' }],
      });

      await recorder.finalize('op-empty-completion', {
        completionReason: 'error',
        error: {
          body: {
            diagnostics: {
              attempt: 1,
              maxAttempts: 1,
              outputTokens: 25_617,
            },
          },
          message: 'Model returned an empty completion',
          retryable: false,
          type: 'ModelEmptyCompletion',
        },
        failedStep: { startedAt: 5000, stepIndex: 1, stepType: 'call_llm' },
        state: { metadata: {}, stepCount: 1 },
      });

      const saved = store.save.mock.calls[0][0];
      const failed = saved.steps.find((s: any) => s.stepIndex === 1);
      expect(failed.stepType).toBe('call_llm');
      expect(failed.events?.[0]).toMatchObject({
        error: {
          body: {
            diagnostics: {
              attempt: 1,
              maxAttempts: 1,
              outputTokens: 25_617,
            },
          },
          type: 'ModelEmptyCompletion',
        },
        type: 'error',
      });
      expect(saved.error.body.diagnostics).toMatchObject({ attempt: 1, maxAttempts: 1 });
    });

    it('merges the error event into an existing step when stepIndex collides (success-path append landed before later failure)', async () => {
      // The success path may have already pushed step 1 to the partial before
      // a later failure (e.g. saveAgentState throws post-append). The recorder
      // must NOT duplicate stepIndex=1; it should attach the error event to
      // the existing record.
      store.loadPartial.mockResolvedValue({
        startedAt: 1000,
        steps: [
          { events: [{ type: 'llm_result' }], stepIndex: 0, stepType: 'call_llm' },
          {
            events: [{ type: 'tool_result' }],
            stepIndex: 1,
            stepType: 'call_tool',
          },
        ],
      });

      await recorder.finalize('op-collide', {
        completionReason: 'error',
        error: { message: 'redis down', type: 'RedisError' },
        failedStep: { startedAt: 5000, stepIndex: 1 },
        state: { metadata: {}, stepCount: 2 },
      });

      const saved = store.save.mock.calls[0][0];
      const matching = saved.steps.filter((s: any) => s.stepIndex === 1);
      expect(matching).toHaveLength(1);
      // Original tool_result event preserved + new error event appended.
      const eventTypes = matching[0].events.map((e: any) => e.type);
      expect(eventTypes).toEqual(['tool_result', 'error']);
    });

    it('reports totalSteps from the finalized step array, not state.stepCount, on the error path', async () => {
      // After appending a synthetic failed step (e.g. step 1 from the catch
      // path), state.stepCount comes from Redis and reflects the last
      // *completed* step (0). Trusting it here would under-count by one.
      store.loadPartial.mockResolvedValue({
        startedAt: 1000,
        steps: [{ stepIndex: 0, stepType: 'call_llm' }],
      });

      await recorder.finalize('op-stepcount', {
        completionReason: 'error',
        error: { message: 'boom', type: 'InternalServerError' },
        failedStep: { startedAt: 5000, stepIndex: 1 },
        state: { metadata: {}, stepCount: 0 },
      });

      const saved = store.save.mock.calls[0][0];
      expect(saved.totalSteps).toBe(2);
    });

    it('skips finalize entirely when no partial exists (op never recorded a step)', async () => {
      store.loadPartial.mockResolvedValue(null);

      await recorder.finalize('op-empty', {
        completionReason: 'error',
        state: { metadata: {} },
      });

      expect(store.save).not.toHaveBeenCalled();
      expect(store.removePartial).not.toHaveBeenCalled();
    });

    it('appends extra signal events to the last step before save', async () => {
      store.loadPartial.mockResolvedValue({
        startedAt: 1000,
        steps: [{ events: [{ type: 'llm_result' }], stepIndex: 0, stepType: 'call_llm' }],
      });

      await recorder.finalize('op-signal', {
        appendEventsToLastStep: [{ payload: { foo: 1 }, type: 'agent_signal_complete' }],
        completionReason: 'done',
        state: { metadata: {} },
      });

      const saved = store.save.mock.calls[0][0];
      const lastStep = saved.steps[0];
      const signalEvent = lastStep.events.find((e: any) => e.type === 'agent_signal_complete');
      expect(signalEvent).toBeDefined();
      expect(signalEvent.payload).toEqual({ foo: 1 });
    });
  });

  describe('contextEngine recording', () => {
    type Ce = { input?: unknown; metadata?: unknown; output?: unknown };

    /**
     * Queue-mode shape: every step runs in a fresh invocation that loads the
     * partial the previous one saved.
     */
    const recordAcrossInvocations = async (
      ces: Array<Ce | undefined>,
      initialSteps: any[] = [],
    ) => {
      let stored: any = { startedAt: 1, steps: initialSteps };
      for (const [offset, ce] of ces.entries()) {
        const store = buildStore();
        store.loadPartial.mockResolvedValue(structuredClone(stored));
        const recorder = new OperationTraceRecorder(store as any);
        await recorder.appendStep('op-ce', {
          afterStepSignalEvents: [],
          agentState: { messages: [] },
          beforeStepSignalEvents: [],
          contextEngine: ce,
          currentContext: { phase: ce ? 'user_input' : 'tool_result' },
          externalRetryCount: 0,
          presentation: buildPresentation({ stepType: ce ? 'call_llm' : 'call_tool' }),
          startedAt: 1000,
          stepIndex: initialSteps.length + offset,
          stepResult: { events: [], newState: { activatedStepTools: [], messages: [] } },
        });
        await recorder.flushPartial();
        // Round-trip through JSON like the real store does.
        // eslint-disable-next-line unicorn/prefer-structured-clone -- the store serializes JSON
        stored = JSON.parse(JSON.stringify(store.savePartial.mock.calls.at(-1)![1]));
      }
      return stored as { steps: any[] };
    };

    const resolveAll = (steps: any[]) => {
      const resolved = resolveContextEngineSteps(steps);
      return steps.map((step) => resolved.get(step));
    };

    const message = (i: number) => ({ content: `message ${i} ${'x'.repeat(200)}`, role: 'user' });
    const growingRun = (steps: number) =>
      Array.from({ length: steps }, (_, i) => ({
        input: {
          agentDocuments: [{ content: `shared doc ${'d'.repeat(2000)}` }],
          planTodo: { done: i },
        },
        output: Array.from({ length: i + 1 }, (_, j) => message(j)),
      }));

    it('routes CE input/output into contextEngine, never into events', async () => {
      const { steps } = await recordAcrossInvocations([{ input: { a: 1 }, output: [] }]);

      expect(steps[0].contextEngine).toBeDefined();
      expect(steps[0].events.some((e: any) => e.type === 'context_engine_result')).toBe(false);
    });

    it('resolves every step back to exactly what the context engine produced', async () => {
      const ces: Array<Ce | undefined> = [
        {
          input: { systemRole: 'be brief', toolCount: 3 },
          metadata: { trim: 0 },
          output: [message(0)],
        },
        undefined, // a tool step runs no CE
        {
          input: { systemRole: 'be brief', toolCount: 3 },
          metadata: { trim: 0 },
          output: [message(0), message(1)],
        },
        // Middle message rewritten (stale tool result trim), metadata changed.
        {
          input: { systemRole: 'be brief', toolCount: 4 },
          metadata: { trim: 1 },
          output: [message(0), { content: '[trimmed]', role: 'tool' }, message(2), message(2)],
        },
        // Compression collapses the history; an input key disappears.
        {
          input: { systemRole: 'be brief' },
          metadata: { trim: 1 },
          output: [{ content: 'summary', role: 'system' }],
        },
      ];

      const { steps } = await recordAcrossInvocations(ces);

      expect(resolveAll(steps)).toEqual(
        ces.map((ce) =>
          ce ? { input: ce.input, metadata: ce.metadata, output: ce.output } : undefined,
        ),
      );
    });

    it('stores each distinct value once however many steps re-send it', async () => {
      const { steps } = await recordAcrossInvocations(growingRun(40));
      const serialized = JSON.stringify(steps);

      expect(serialized.split('message 0 ').length - 1).toBe(1);
      expect(serialized.split('message 39 ').length - 1).toBe(1);
      expect(serialized.split('shared doc').length - 1).toBe(1);
      expect(resolveAll(steps).at(-1)?.output).toHaveLength(40);
    });

    it('grows linearly with the conversation, not with steps × context', async () => {
      const size = async (n: number) =>
        JSON.stringify((await recordAcrossInvocations(growingRun(n))).steps).length;

      const [small, large] = [await size(50), await size(100)];

      // Quadratic storage would quadruple; linear doubles (plus per-step refs).
      expect(large / small).toBeLessThan(2.6);
    });

    it('continues a partial recorded in the changed-fields format', async () => {
      const legacy = [
        {
          contextEngine: { input: { toolCount: 3 }, metadata: { trim: 0 }, output: [message(0)] },
          stepIndex: 0,
          stepType: 'call_llm',
        },
        { contextEngine: {}, stepIndex: 1, stepType: 'call_llm' },
      ];
      const next = {
        input: { toolCount: 3 },
        metadata: { trim: 0 },
        output: [message(0), message(1)],
      };

      const { steps } = await recordAcrossInvocations([next], legacy);

      expect(resolveAll(steps)).toEqual([
        { input: { toolCount: 3 }, metadata: { trim: 0 }, output: [message(0)] },
        { input: { toolCount: 3 }, metadata: { trim: 0 }, output: [message(0)] },
        next,
      ]);
    });

    it('re-pools a value whose introducing step never reached the store', async () => {
      const first = await recordAcrossInvocations([{ input: { a: 1 }, output: [message(0)] }]);
      // The step that pooled message 0 was lost (crash before upload): the
      // next invocation starts from a partial that lacks it.
      const lostPredecessor = first.steps.map((step) => ({ ...step, stepIndex: 99 })).slice(0, 0);

      const { steps } = await recordAcrossInvocations(
        [{ input: { a: 1 }, output: [message(0), message(1)] }],
        lostPredecessor,
      );

      expect(resolveAll(steps)[0]?.output).toEqual([message(0), message(1)]);
    });

    it('stores metadata only when it changes', async () => {
      const { steps } = await recordAcrossInvocations([
        { input: {}, metadata: { trim: 1 }, output: [] },
        { input: {}, metadata: { trim: 1 }, output: [] },
        { input: {}, metadata: { trim: 2 }, output: [] },
      ]);

      expect(steps.map((step) => step.contextEngine.metadata)).toEqual([
        { trim: 1 },
        undefined,
        { trim: 2 },
      ]);
    });

    it('records the values as of the append, not later mutations of the source objects', async () => {
      const store = buildStore();
      store.loadPartial.mockResolvedValue({ startedAt: 1, steps: [] });
      const recorder = new OperationTraceRecorder(store as any);
      const output = [{ content: 'before', role: 'user', at: new Date(0) }];

      await recorder.appendStep('op-ce', {
        afterStepSignalEvents: [],
        agentState: { messages: [] },
        beforeStepSignalEvents: [],
        contextEngine: { input: { toolCount: 1 }, output },
        currentContext: { phase: 'user_input' },
        externalRetryCount: 0,
        presentation: buildPresentation(),
        startedAt: 1000,
        stepIndex: 0,
        stepResult: { events: [], newState: { activatedStepTools: [], messages: [] } },
      });
      output[0].content = 'after';
      await recorder.flushPartial();

      const { steps } = store.savePartial.mock.calls.at(-1)![1];
      expect(resolveAll(steps)[0]?.output).toEqual([
        { at: '1970-01-01T00:00:00.000Z', content: 'before', role: 'user' },
      ]);
    });

    it('sets contextEngine to undefined when no CE was recorded for the step', async () => {
      const { steps } = await recordAcrossInvocations([{ input: { a: 1 }, output: [] }, undefined]);

      expect(steps[1].contextEngine).toBeUndefined();
    });
  });

  describe('store=null (snapshot tracing disabled)', () => {
    it('appendStep is a no-op', async () => {
      const recorder = new OperationTraceRecorder(null);
      expect(recorder.enabled).toBe(false);
      await expect(
        recorder.appendStep('op-x', {
          afterStepSignalEvents: [],
          agentState: {},
          beforeStepSignalEvents: [],
          externalRetryCount: 0,
          presentation: buildPresentation(),
          startedAt: 0,
          stepIndex: 0,
          stepResult: { events: [], newState: { messages: [] } },
        }),
      ).resolves.toBeUndefined();
    });

    it('finalize is a no-op', async () => {
      const recorder = new OperationTraceRecorder(null);
      await expect(
        recorder.finalize('op-x', { completionReason: 'done', state: {} }),
      ).resolves.toBeUndefined();
    });
  });
});

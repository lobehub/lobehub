// @vitest-environment node
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
          metadata: { agentConfig: { model: 'claude-sonnet-4-6', provider: 'lobehub' } },
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
            messages: ['heavy'],
            operationToolSet: { manifestMap: {} },
            otherStateField: 'kept',
            toolManifestMap: {},
            toolSourceMap: {},
            tools: [],
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
      expect(doneEvent.finalState.messages).toBeUndefined();
      expect(doneEvent.finalState.operationToolSet).toBeUndefined();
      expect(doneEvent.finalState.toolManifestMap).toBeUndefined();
      expect(doneEvent.finalState.toolSourceMap).toBeUndefined();
      expect(doneEvent.finalState.tools).toBeUndefined();
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
          metadata: { agentId: 'agt-1', topicId: 'tpc-1', userId: 'u-1' },
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

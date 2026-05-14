import type { ISnapshotStore, StepSnapshot } from '@lobechat/agent-tracing';
import debug from 'debug';

import type { StepCompletionReason, StepPresentationData } from './types';

const log = debug('lobe-server:operation-trace-recorder');

type SignalEvent = { [key: string]: unknown; type: string };

export interface AppendStepParams {
  afterStepSignalEvents: SignalEvent[];
  /**
   * Agent state BEFORE this step ran. Used to derive the message baseline,
   * activatedStepTools delta, and the partial header (model / provider).
   */
  agentState: any;
  beforeStepSignalEvents: SignalEvent[];
  currentContext?: { payload?: unknown; phase?: string; stepContext?: unknown };
  externalRetryCount: number;
  presentation: StepPresentationData;
  startedAt: number;
  stepIndex: number;
  /**
   * Result of running this step. Carries new messages, raw events, and the
   * post-step activatedStepTools list.
   */
  stepResult: { events?: unknown[]; newState: any };
}

export interface FinalizeParams {
  /**
   * Events to merge into the last partial step before save. Used by the
   * success path to attach agentSignal completion events to the trailing
   * step. Error path leaves this empty.
   */
  appendEventsToLastStep?: SignalEvent[];
  completionReason: StepCompletionReason;
  error?: { message: string; type: string };
  /**
   * Synthetic step record for the error path. The real failing step never
   * reached `appendStep` because the executor threw before the partial push,
   * so the catch caller passes this to keep step counts aligned with the
   * assistant message that triggered the call. See LOBE-8533.
   */
  failedStep?: { startedAt: number; stepIndex: number };
  state: any;
}

/**
 * Encapsulates per-operation trace snapshot accumulation and finalization.
 *
 * Built on top of an `ISnapshotStore` (S3 in production, file-system in dev).
 * The recorder owns:
 * - Partial header init (model / provider on first step)
 * - Per-step incremental message diffing + heavy-event stripping
 * - Finalize into the canonical S3 path on completion or error
 *
 * Callers don't need to gate on `enabled` — when the underlying store is null,
 * methods are no-ops.
 */
export class OperationTraceRecorder {
  constructor(private readonly store: ISnapshotStore | null) {}

  get enabled(): boolean {
    return this.store !== null;
  }

  async appendStep(operationId: string, params: AppendStepParams): Promise<void> {
    if (!this.store) return;

    try {
      const partial = (await this.store.loadPartial(operationId)) ?? { steps: [] };

      this.initPartialHeader(partial, params.agentState);

      if (!partial.steps) partial.steps = [];
      const newStep = this.buildStepSnapshot(params);
      this.deduplicateCeSnapshot(newStep, partial.steps);
      partial.steps.push(newStep);

      await this.store.savePartial(operationId, partial);
    } catch (e) {
      log('[%s] snapshot step recording failed: %O', operationId, e);
    }
  }

  async finalize(operationId: string, params: FinalizeParams): Promise<void> {
    if (!this.store) return;

    try {
      const partial = await this.store.loadPartial(operationId);
      if (!partial) {
        // No partial recorded — nothing to finalize. Skip rather than write
        // an empty snapshot.
        return;
      }

      if (params.appendEventsToLastStep?.length && partial.steps?.length) {
        const lastStep = partial.steps.at(-1);
        if (lastStep) {
          lastStep.events = [...(lastStep.events ?? []), ...params.appendEventsToLastStep];
        }
      }

      if (params.failedStep) {
        if (!partial.steps) partial.steps = [];
        // The success path may have already appended this step to the partial
        // before a later failure (e.g. saveAgentState or queue scheduling
        // throwing post-append). In that case attach the error event to the
        // existing record instead of pushing a duplicate stepIndex —
        // duplicates corrupt ordering and per-step metrics in trace
        // reconstruction.
        const existing = partial.steps.find((s) => s.stepIndex === params.failedStep!.stepIndex);
        if (existing) {
          if (params.error) {
            existing.events = [...(existing.events ?? []), { error: params.error, type: 'error' }];
          }
        } else {
          const now = Date.now();
          partial.steps.push({
            completedAt: now,
            events: params.error ? [{ error: params.error, type: 'error' }] : undefined,
            executionTimeMs: now - params.failedStep.startedAt,
            startedAt: params.failedStep.startedAt,
            stepIndex: params.failedStep.stepIndex,
            // StepSnapshot.stepType is strictly 'call_llm' | 'call_tool';
            // persist-fatal originates in the tool path so 'call_tool' is the
            // truthful label. LLM-side failures still map here — the
            // surrounding `events: [{type: 'error'}]` is the discriminant
            // consumers read.
            stepType: 'call_tool',
            totalCost: params.state?.cost?.total ?? 0,
            totalTokens: params.state?.usage?.llm?.tokens?.total ?? 0,
          });
        }
      }

      const metadata = (params.state?.metadata ?? {}) as any;
      const finalizedSteps = (partial.steps ?? []).sort((a, b) => a.stepIndex - b.stepIndex);
      const snapshot = {
        agentId: metadata?.agentId,
        completedAt: Date.now(),
        completionReason: params.completionReason,
        error: params.error,
        externalRetryCount:
          typeof metadata?.externalRetryCount === 'number'
            ? metadata.externalRetryCount
            : undefined,
        model: partial.model,
        operationId,
        provider: partial.provider,
        retryDelayExpression:
          typeof metadata?.queueRetryDelay === 'string' ? metadata.queueRetryDelay : undefined,
        startedAt: partial.startedAt ?? Date.now(),
        steps: finalizedSteps,
        topicId: metadata?.topicId,
        totalCost: params.state?.cost?.total ?? 0,
        // Trust the finalized step array over `state.stepCount`: on the error
        // path stepCount comes from Redis and reflects the last completed
        // step, so it lags behind the synthetic failed step we just appended.
        totalSteps: finalizedSteps.length || (params.state?.stepCount ?? 0),
        totalTokens: params.state?.usage?.llm?.tokens?.total ?? 0,
        traceId: operationId,
        userId: metadata?.userId,
      };

      await this.store.save(snapshot as any);
      await this.store.removePartial(operationId);
    } catch (e) {
      log('[%s] snapshot finalize failed (reason=%s): %O', operationId, params.completionReason, e);
    }
  }

  /**
   * Strip `contextEngine` input/output fields that are identical to the most-recently
   * stored values in previous steps. The viewer reconstructs the full snapshot by
   * walking back through the step list (same pattern as messagesBaseline + messagesDelta).
   */
  private deduplicateCeSnapshot(step: StepSnapshot, prevSteps: StepSnapshot[]): void {
    if (!step.contextEngine) return;

    let lastInputJson: string | undefined;
    let lastOutputJson: string | undefined;

    for (let i = prevSteps.length - 1; i >= 0; i--) {
      const prev = prevSteps[i];
      if (!prev.contextEngine) continue;
      if (lastInputJson === undefined && prev.contextEngine.input !== undefined) {
        lastInputJson = JSON.stringify(prev.contextEngine.input);
      }
      if (lastOutputJson === undefined && prev.contextEngine.output !== undefined) {
        lastOutputJson = JSON.stringify(prev.contextEngine.output);
      }
      if (lastInputJson !== undefined && lastOutputJson !== undefined) break;
    }

    const storeInput =
      lastInputJson === undefined || JSON.stringify(step.contextEngine.input) !== lastInputJson;
    const storeOutput =
      lastOutputJson === undefined || JSON.stringify(step.contextEngine.output) !== lastOutputJson;

    step.contextEngine = {
      ...(storeInput ? { input: step.contextEngine.input } : {}),
      ...(storeOutput ? { output: step.contextEngine.output } : {}),
    };
  }

  private initPartialHeader(partial: any, agentState: any): void {
    if (partial.startedAt) return;
    partial.startedAt = Date.now();
    partial.model =
      (agentState?.metadata as any)?.agentConfig?.model ?? agentState?.modelRuntimeConfig?.model;
    partial.provider =
      (agentState?.metadata as any)?.agentConfig?.provider ??
      agentState?.modelRuntimeConfig?.provider;
  }

  private buildStepSnapshot(params: AppendStepParams): StepSnapshot {
    const {
      agentState,
      afterStepSignalEvents,
      beforeStepSignalEvents,
      currentContext,
      externalRetryCount,
      presentation,
      startedAt,
      stepIndex,
      stepResult,
    } = params;

    // Incremental diff: only store message delta + baseline at reset points.
    const prevMessages = agentState?.messages ?? [];
    const afterMessages = stepResult.newState.messages;
    const isCompression = (stepResult.events as any[])?.some(
      (e) => e.type === 'compression_complete',
    );
    const isBaseline = stepIndex === 0 || isCompression;
    const messagesDelta = afterMessages.slice(prevMessages.length);

    // Extract context_engine_result into contextEngine (dedicated typed field).
    // CE data is structural state, not a streaming event — it lives separately
    // from events and uses the same delta pattern as messagesBaseline/messagesDelta.
    const rawEvents = (stepResult.events as any[]) ?? [];
    const ceEvent = rawEvents.find((e: any) => e.type === 'context_engine_result') as any;
    const contextEngine: StepSnapshot['contextEngine'] = ceEvent
      ? { input: ceEvent.input, output: ceEvent.output }
      : undefined;

    // Strip heavy/redundant data from events before persisting to snapshot.
    // context_engine_result is excluded — stored in contextEngine instead.
    const snapshotEvents = [
      ...beforeStepSignalEvents,
      ...rawEvents
        .filter((e) => e.type !== 'llm_stream' && e.type !== 'context_engine_result')
        .map((e) => {
          if (e.type === 'done' && e.finalState) {
            // Remove reconstructible fields from finalState:
            // - messages: from messagesBaseline + messagesDelta chain
            // - operationToolSet: from toolsetBaseline (step 0)
            // - toolManifestMap/tools/toolSourceMap: backward-compat copies of operationToolSet
            const {
              messages: _msgs,
              operationToolSet: _ots,
              toolManifestMap: _tmm,
              toolSourceMap: _tsm,
              tools: _tools,
              // activatedStepTools is kept since it's the cumulative record
              ...restState
            } = e.finalState;
            return { ...e, finalState: restState };
          }
          return e;
        }),
      ...afterStepSignalEvents,
    ];

    // Strip toolResults from payload (already in step.toolsResult).
    let snapshotPayload: unknown = currentContext?.payload;
    if (
      snapshotPayload &&
      typeof snapshotPayload === 'object' &&
      'toolResults' in snapshotPayload
    ) {
      const { toolResults: _tr, ...restPayload } = snapshotPayload as Record<string, unknown>;
      snapshotPayload = restPayload;
    }

    // Compute activatedStepTools delta (newly discovered tools in this step).
    const prevActivated = agentState?.activatedStepTools ?? [];
    const afterActivated = stepResult.newState.activatedStepTools ?? [];
    const activatedStepToolsDelta =
      afterActivated.length > prevActivated.length
        ? afterActivated.slice(prevActivated.length)
        : undefined;

    return {
      activatedStepToolsDelta,
      contextEngine,
      completedAt: Date.now(),
      content: presentation.content,
      context: {
        payload: snapshotPayload,
        phase: currentContext?.phase ?? 'unknown',
        stepContext: currentContext?.stepContext,
      },
      events: snapshotEvents,
      executionTimeMs: presentation.executionTimeMs,
      externalRetryCount,
      inputTokens: presentation.stepInputTokens,
      isCompressionReset: isCompression || undefined,
      messagesBaseline: isBaseline ? prevMessages : undefined,
      messagesDelta,
      outputTokens: presentation.stepOutputTokens,
      reasoning: presentation.reasoning,
      startedAt,
      stepIndex,
      stepType: presentation.stepType,
      // Store operation-level toolset once at step 0
      toolsetBaseline: stepIndex === 0 ? agentState?.operationToolSet : undefined,
      toolsCalling: presentation.toolsCalling,
      toolsResult: presentation.toolsResult,
      totalCost: presentation.totalCost,
      totalTokens: presentation.totalTokens,
    };
  }
}

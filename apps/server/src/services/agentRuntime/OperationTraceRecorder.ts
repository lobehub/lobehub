import { createHash } from 'node:crypto';

import type { ExecutionSnapshot, ISnapshotStore, StepSnapshot } from '@lobechat/agent-tracing';
import type { ChatMessageErrorAttribution, ChatMessageErrorSeverity } from '@lobechat/types';
import debug from 'debug';

import type { StepCompletionReason, StepPresentationData } from './types';

const log = debug('lobe-server:operation-trace-recorder');

type SignalEvent = { [key: string]: unknown; type: string };

/** Pool candidates of one step: ref → JSON text of the value it names. */
type CePoolCandidates = Map<string, string>;

/** One captured step's CE payload before it is pooled against the partial. */
interface CapturedCe {
  candidates: CePoolCandidates;
  /** Refs of the output messages, in order, when the output is a list. */
  outputRefs?: string[];
}

/** What the partial already pools, so a step stores only what is new. */
interface CePoolState {
  /** The last pooled output list: its node ancestry (root first) and message refs. */
  lastOutput?: { chain: Array<{ length: number; ref: string }>; refs: string[] };
  refs: Set<string>;
}

const ceRef = (json: string) => createHash('sha256').update(json).digest('base64url').slice(0, 22);

export interface AppendStepParams {
  afterStepSignalEvents: SignalEvent[];
  /**
   * Agent state BEFORE this step ran. Used to derive the message baseline,
   * activatedStepTools delta, and the partial header (model / provider).
   */
  agentState: any;
  beforeStepSignalEvents: SignalEvent[];
  /**
   * Context engine input/output captured for this step. Delivered via
   * `RuntimeExecutorContext.tracingContextEngine` rather than through the
   * `events` array, so CE payloads (agentDocuments, systemRole, …) stay out
   * of the Redis state pipeline.
   *
   * Context: agent-runtime state blob was hitting Upstash Redis 10MB limit
   * because ~97% of each step payload was tracing-only fields. Routing CE
   * via tracingContextEngine keeps it in trace only, keeping Redis state lean.
   *
   * `metadata` carries the pipeline's per-request decisions (trim stats,
   * cache-warmth gate inputs/outputs, truncation counts) — small scalar
   * records, safe to store every step.
   */
  contextEngine?: { input?: unknown; metadata?: unknown; output?: unknown };
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
  /**
   * Top-level error on the persisted snapshot. The classification fields
   * (`attribution`, `category`, `severity`, …) mirror `ChatMessageError` and
   * are sourced from `ERROR_CODE_SPECS` at the runtime catch site; unknown
   * codes simply omit them.
   */
  error?: {
    attribution?: ChatMessageErrorAttribution;
    body?: unknown;
    category?: string;
    countAsFailure?: boolean;
    httpStatus?: number;
    message: string;
    numericId?: number;
    retryable?: boolean;
    severity?: ChatMessageErrorSeverity;
    type: string;
  };
  /**
   * Synthetic step record for the error path. The real failing step never
   * reached `appendStep` because the executor threw before the partial push,
   * so the catch caller passes this to keep step counts aligned with the
   * assistant message that triggered the call. See .
   */
  failedStep?: { startedAt: number; stepIndex: number; stepType?: 'call_llm' | 'call_tool' };
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
  /**
   * The partial this invocation is accumulating, kept in memory so a step
   * boundary no longer pays a full read-modify-write of the whole trace.
   * Measured in production (Tempo, 75 steps): ~570ms GET + ~960ms PUT per step,
   * on the critical path between two steps of an inlined run.
   */
  private cached: {
    /** The partial's CE pool index, built on first use. */
    cePool?: CePoolState;
    operationId: string;
    partial: Partial<ExecutionSnapshot>;
  } | null = null;

  /** In-flight upload, if any. Never rejects — `drainSaves` logs and continues. */
  private pendingSave: Promise<void> | undefined;

  /** Set when the cached partial has steps the store has not seen yet. */
  private dirty = false;

  /** Aborts the upload in flight when this invocation stops owning the operation. */
  private saveAbort: AbortController | undefined;

  constructor(private readonly store: ISnapshotStore | null) {}

  get enabled(): boolean {
    return this.store !== null;
  }

  async appendStep(operationId: string, params: AppendStepParams): Promise<void> {
    if (!this.store) return;

    try {
      const partial = await this.loadCachedPartial(operationId);

      this.initPartialHeader(partial, params.agentState);

      if (!partial.steps) partial.steps = [];
      const { ce, step: newStep } = this.buildStepSnapshot(params);
      this.poolCeSnapshot(newStep, ce, partial.steps, this.cePoolState(partial));
      partial.steps.push(newStep);

      // Upload in the background: the next step only needs the in-memory copy,
      // and the upload overlaps with it instead of delaying it. Anything that
      // reads the partial from another process waits via `flushPartial`.
      this.scheduleSave(operationId);
    } catch (e) {
      log('[%s] snapshot step recording failed: %O', operationId, e);
    }
  }

  /**
   * Wait for the accumulated partial to become durable. Required before any
   * other process reads it: a queue hand-off, a parked operation, or
   * finalization.
   */
  async flushPartial(): Promise<void> {
    if (!this.store) return;

    if (this.dirty && this.cached) this.scheduleSave(this.cached.operationId);
    await this.pendingSave;
  }

  /**
   * Drop the in-memory partial without uploading it. Used when this invocation
   * loses the operation lock: the worker that took over owns the partial now,
   * and writing ours over it would roll back the steps it recorded.
   */
  discardPartial(): void {
    this.dirty = false;
    this.cached = null;
    // An upload already in flight was started while this invocation still owned
    // the operation, and carries a partial the new owner has moved past. Abort
    // it rather than let it land on top of theirs.
    this.saveAbort?.abort();
    this.saveAbort = undefined;
  }

  private async loadCachedPartial(operationId: string): Promise<Partial<ExecutionSnapshot>> {
    if (this.cached?.operationId === operationId) return this.cached.partial;

    // A different operation must not inherit this cache, and its queued upload
    // still points at the object we are about to forget — land it first.
    if (this.cached) await this.flushPartial();

    const partial = (await this.store!.loadPartial(operationId)) ?? { steps: [] };
    this.cached = { operationId, partial };
    return partial;
  }

  private scheduleSave(operationId: string): void {
    this.dirty = true;
    if (this.pendingSave) return;

    this.pendingSave = this.drainSaves(operationId).finally(() => {
      this.pendingSave = undefined;
    });
  }

  /**
   * Uploads until the cached partial is clean. Steps appended while an upload is
   * in flight are picked up by the next iteration, so a fast run collapses
   * several step appends into one upload instead of one upload per step.
   */
  private async drainSaves(operationId: string): Promise<void> {
    while (this.dirty) {
      this.dirty = false;

      const partial = this.cached?.operationId === operationId ? this.cached.partial : undefined;
      if (!partial) return;

      const abort = new AbortController();
      this.saveAbort = abort;
      try {
        await this.store!.savePartial(operationId, partial, { signal: abort.signal });
      } catch (e) {
        // Matches the previous behaviour: a failed partial upload degrades the
        // trace, it never fails the step that produced it. An abort lands here
        // too — the partial it carried is deliberately not written.
        log('[%s] partial snapshot upload failed: %O', operationId, e);
      } finally {
        if (this.saveAbort === abort) this.saveAbort = undefined;
      }
    }
  }

  async finalize(operationId: string, params: FinalizeParams): Promise<void> {
    if (!this.store) return;

    try {
      // Land whatever is still queued: the upload in flight writes the same
      // object we are about to finalize, and `removePartial` below must not
      // race an upload that would resurrect the partial afterwards.
      await this.flushPartial();

      const partial =
        this.cached?.operationId === operationId
          ? this.cached.partial
          : await this.store.loadPartial(operationId);
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
            stepType: params.failedStep.stepType ?? 'call_tool',
            totalCost: params.state?.cost?.total ?? 0,
            totalTokens: params.state?.usage?.llm?.tokens?.total ?? 0,
          });
        }
      }

      const metadata = (params.state?.metadata ?? {}) as any;
      const origin = params.state?.origin ?? {};
      const finalizedSteps = (partial.steps ?? []).sort((a, b) => a.stepIndex - b.stepIndex);
      const snapshot = {
        agentId: origin.agentId,
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
        retryDelayExpression: params.state?.host?.queue?.retryDelay,
        startedAt: partial.startedAt ?? Date.now(),
        steps: finalizedSteps,
        topicId: origin.topicId,
        totalCost: params.state?.cost?.total ?? 0,
        // Trust the finalized step array over `state.stepCount`: on the error
        // path stepCount comes from Redis and reflects the last completed
        // step, so it lags behind the synthetic failed step we just appended.
        totalSteps: finalizedSteps.length || (params.state?.stepCount ?? 0),
        totalTokens: params.state?.usage?.llm?.tokens?.total ?? 0,
        traceId: operationId,
        userId: origin.userId,
      };

      await this.store.save(snapshot as any);
      // Forget the partial before deleting it, so a late `appendStep` on this
      // recorder cannot re-upload the object we just removed.
      this.discardPartial();
      // Human intervention and async tools can continue this operation id. Keep
      // the partial alongside the readable waiting snapshot until the real end.
      if (
        params.completionReason !== 'waiting_for_human' &&
        params.completionReason !== 'waiting_for_async_tool'
      ) {
        await this.store.removePartial(operationId);
      }
    } catch (e) {
      log('[%s] snapshot finalize failed (reason=%s): %O', operationId, params.completionReason, e);
    }
  }

  /** Index what the partial's steps already pooled — recorded values are never repeated. */
  private cePoolState(partial: Partial<ExecutionSnapshot>): CePoolState {
    if (this.cached?.partial === partial && this.cached.cePool) return this.cached.cePool;

    const pool = new Map<string, unknown>();
    for (const step of partial.steps ?? []) {
      for (const [ref, value] of Object.entries(step.contextEngine?.pool ?? {})) {
        pool.set(ref, value);
      }
    }
    const state: CePoolState = { refs: new Set(pool.keys()) };

    // Extend the list of the last recorded step. Any earlier list would also be
    // correct; the most recent one shares the longest prefix.
    const lastRef = partial.steps?.findLast((step) => step.contextEngine?.outputRef)?.contextEngine
      ?.outputRef;
    const nodes: Array<{ base?: string; ref: string; refs: string[] }> = [];
    for (let ref = lastRef; ref !== undefined && nodes.length <= pool.size;) {
      const node = pool.get(ref) as { base?: string; refs: string[] } | undefined;
      if (!node) break;
      nodes.unshift({ ...node, ref });
      ref = node.base;
    }
    if (lastRef !== undefined && nodes[0] && nodes[0].base === undefined) {
      const refs: string[] = [];
      const chain = nodes.map((node) => {
        refs.push(...node.refs);
        return { length: refs.length, ref: node.ref };
      });
      state.lastOutput = { chain, refs };
    }

    if (this.cached?.partial === partial) this.cached.cePool = state;
    return state;
  }

  /**
   * Store only what the partial does not hold yet. The output list becomes a
   * node extending the longest prefix it shares with the last recorded list,
   * every value lands in this step's pool unless an earlier step pooled it, and
   * `metadata` is dropped when it equals the last stored one. A long run
   * re-sends nearly the same messages on every LLM call, so storing whole
   * payloads per step grows the trace — and the per-step read and rewrite of
   * the partial — with steps × context size. `resolveContextEngineSteps`
   * reverses this.
   */
  private poolCeSnapshot(
    step: StepSnapshot,
    captured: CapturedCe,
    prevSteps: StepSnapshot[],
    state: CePoolState,
  ): void {
    const ce = step.contextEngine;
    if (!ce) return;

    const { candidates, outputRefs } = captured;
    if (outputRefs) {
      const last = state.lastOutput;
      let shared = 0;
      while (
        last &&
        shared < last.refs.length &&
        shared < outputRefs.length &&
        last.refs[shared] === outputRefs[shared]
      ) {
        shared++;
      }
      const ancestorIndex = last ? last.chain.findLastIndex((node) => node.length <= shared) : -1;
      const ancestor = ancestorIndex >= 0 ? last!.chain[ancestorIndex] : undefined;

      if (ancestor && ancestor.length === outputRefs.length) {
        ce.outputRef = ancestor.ref;
      } else {
        const node = {
          ...(ancestor && { base: ancestor.ref }),
          refs: outputRefs.slice(ancestor?.length ?? 0),
        };
        const json = JSON.stringify(node);
        ce.outputRef = ceRef(json);
        candidates.set(ce.outputRef, json);
      }
      state.lastOutput = {
        chain: [
          ...(last?.chain.slice(0, ancestorIndex + 1) ?? []),
          ...(ancestor?.ref === ce.outputRef
            ? []
            : [{ length: outputRefs.length, ref: ce.outputRef }]),
        ],
        refs: outputRefs,
      };
    }

    const pool: Record<string, unknown> = {};
    for (const [ref, json] of candidates) {
      if (state.refs.has(ref)) continue;
      pool[ref] = JSON.parse(json);
      state.refs.add(ref);
    }
    if (Object.keys(pool).length > 0) ce.pool = pool;

    if (ce.metadata === undefined) return;
    const lastMetadata = prevSteps.findLast((prev) => prev.contextEngine?.metadata !== undefined)
      ?.contextEngine?.metadata;
    if (
      lastMetadata !== undefined &&
      JSON.stringify(ce.metadata) === JSON.stringify(lastMetadata)
    ) {
      delete ce.metadata;
    }
  }

  /**
   * Capture the CE payload as JSON now: the next step can mutate the source
   * objects while a trace read is pending, and Dates convert once here instead
   * of on every serialization of the partial. Object inputs become refs and
   * array outputs message refs (values go to the pool candidates); other
   * shapes stay whole.
   */
  private captureCeSnapshot(ceInput: AppendStepParams['contextEngine']): {
    ce: CapturedCe;
    contextEngine: StepSnapshot['contextEngine'];
  } {
    const ce: CapturedCe = { candidates: new Map() };
    if (!ceInput) return { ce, contextEngine: undefined };

    const toRef = (value: unknown): string | undefined => {
      const json = JSON.stringify(value);
      if (json === undefined) return undefined;
      const ref = ceRef(json);
      ce.candidates.set(ref, json);
      return ref;
    };
    const copy = (value: unknown) => {
      const json = JSON.stringify(value);
      return json === undefined ? undefined : JSON.parse(json);
    };

    const contextEngine: NonNullable<StepSnapshot['contextEngine']> = {};
    const { input, metadata, output } = ceInput;

    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const inputRefs: Record<string, string> = {};
      for (const [key, value] of Object.entries(input)) {
        const ref = toRef(value);
        if (ref !== undefined) inputRefs[key] = ref;
      }
      contextEngine.inputRefs = inputRefs;
    } else if (input !== undefined) {
      contextEngine.input = copy(input);
    }

    if (Array.isArray(output)) {
      // JSON turns a hole or `undefined` element into `null`; keep that meaning.
      ce.outputRefs = output.map((value) => toRef(value) ?? toRef(null)!);
    } else if (output !== undefined) {
      contextEngine.output = copy(output);
    }

    if (metadata !== undefined) contextEngine.metadata = copy(metadata);

    return { ce, contextEngine };
  }

  private initPartialHeader(partial: any, agentState: any): void {
    if (partial.startedAt) return;
    partial.startedAt = Date.now();
    partial.model = agentState?.world?.agent?.model ?? agentState?.modelRuntimeConfig?.model;
    partial.provider =
      agentState?.world?.agent?.provider ?? agentState?.modelRuntimeConfig?.provider;
  }

  private buildStepSnapshot(params: AppendStepParams): { ce: CapturedCe; step: StepSnapshot } {
    const {
      agentState,
      afterStepSignalEvents,
      beforeStepSignalEvents,
      contextEngine: ceInput,
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

    // CE data is structural state, not a streaming event — delivered via the
    // typed `contextEngine` field on AppendStepParams (sourced from
    // RuntimeExecutorContext.tracingContextEngine).
    const { ce, contextEngine } = this.captureCeSnapshot(ceInput);

    // Strip heavy/redundant data from events before persisting to snapshot.
    const rawEvents = (stepResult.events as any[]) ?? [];
    const snapshotEvents = [
      ...beforeStepSignalEvents,
      ...rawEvents
        .filter((e) => e.type !== 'llm_stream')
        .map((e) => {
          if (e.type === 'done' && e.finalState) {
            // Remove reconstructible fields from finalState:
            // - messages: from messagesBaseline + messagesDelta chain
            // - operationToolSet: from toolsetBaseline (step 0)
            // - toolManifestMap/tools/toolSourceMap: legacy mirrors of operationToolSet
            // - world.expertise (and its legacy top-level copy): immutable
            //   operation-level snapshot retained in working state
            const {
              expertise: _expertise,
              messages: _msgs,
              operationToolSet: _ots,
              toolManifestMap: _tmm,
              toolSourceMap: _tsm,
              tools: _tools,
              world: _world,
              // activatedStepTools is kept since it's the cumulative record
              ...restState
            } = e.finalState;
            const { expertise: _worldExpertise, ...worldRest } = _world ?? {};
            return {
              ...e,
              finalState: _world ? { ...restState, world: worldRest } : restState,
            };
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

    const step: StepSnapshot = {
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
      totalCost: presentation.stepCost ?? 0,
      totalTokens: presentation.stepTotalTokens ?? 0,
    };
    return { ce, step };
  }
}

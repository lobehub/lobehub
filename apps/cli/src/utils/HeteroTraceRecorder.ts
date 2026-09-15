import {
  type ExecutionSnapshot,
  finalizeSnapshot,
  type ISnapshotStore,
  type StepSnapshot,
} from '@lobechat/agent-tracing';
import type { AgentStreamEvent } from '@lobechat/heterogeneous-agents/spawn';

/**
 * Assistant text / reasoning kept per step. Generous — this is the part a human
 * actually reads back — but not unbounded: the partial snapshot is rewritten in
 * full on every step, so an uncapped field turns a long run into quadratic I/O.
 */
const MAX_CONTENT_CHARS = 64 * 1024;

/**
 * Tool output kept per step. Much tighter than assistant text: a single `Read`
 * of a large file would otherwise dominate the whole trace.
 */
const MAX_TOOL_OUTPUT_CHARS = 8 * 1024;

/** Event types worth keeping verbatim — everything else is already structured. */
const NOTABLE_EVENT_TYPES = new Set([
  'error',
  'stream_retry',
  'agent_intervention_request',
  'agent_intervention_response',
]);

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' ? (value as Record<string, any>) : {};

/** Per-turn totals, used when the session grand total never arrived. */
export const sumStepTokens = (steps?: Array<{ totalTokens?: number }>): number =>
  (steps ?? []).reduce((total, step) => total + (step.totalTokens ?? 0), 0);

interface OpenLlmStep {
  content: string;
  events: Array<{ [key: string]: unknown; type: string }>;
  model?: string;
  provider?: string;
  reasoning: string;
  startedAt: number;
  toolsCalling: Array<{ apiName: string; arguments?: string; identifier: string }>;
}

interface OpenToolStep {
  apiName: string;
  arguments?: string;
  identifier: string;
  isSuccess?: boolean;
  output?: string;
  startedAt: number;
}

export interface HeteroTraceRecorderOptions {
  agentType: string;
  /** Best-effort warning sink. A trace failure must never fail the run. */
  onError?: (message: string) => void;
  operationId: string;
  store: ISnapshotStore;
  topicId?: string;
}

export type HeteroRunResult = 'cancelled' | 'error' | 'success';

/**
 * Records a heterogeneous agent run as an `ExecutionSnapshot` on local disk.
 *
 * The stream a CLI-wrapped agent emits (`stream_start` … `step_complete`,
 * `tool_start` … `tool_end`) already carries everything a step needs, so this
 * folds it into the SAME snapshot format the server writes for native agent
 * runs — which is what lets `lh trace op inspect` read both without branching.
 *
 * Fields that only a native run can produce (`messagesBaseline`,
 * `contextEngine`, `toolsetBaseline`) are simply absent; they are optional on
 * `StepSnapshot` precisely so a partial producer stays valid.
 *
 * Every method is best-effort: a failed write is logged and swallowed. Losing a
 * trace is an inconvenience, losing the run is not acceptable.
 */
export class HeteroTraceRecorder {
  private llmStep: OpenLlmStep | null = null;
  private nextStepIndex = 0;
  private readonly partial: Partial<ExecutionSnapshot>;
  private readonly toolSteps = new Map<string, OpenToolStep>();

  /** Grand totals from `step_complete{phase:'result_usage'}`, if the CLI reports them. */
  private totalCost = 0;
  private totalTokens = 0;

  // Serialized, coalescing writer: at most one write in flight, and a write
  // that lands while another is running is folded into a single follow-up.
  private dirty = false;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly options: HeteroTraceRecorderOptions) {
    this.partial = {
      agentId: undefined,
      operationId: options.operationId,
      // The CLI-wrapped agent IS the provider here (`claude-code`, `codex`) —
      // the wrapped model's vendor is reported separately per turn.
      provider: options.agentType,
      startedAt: Date.now(),
      steps: [],
      topicId: options.topicId,
      traceId: options.operationId,
    };
  }

  /** Feed one event. Never throws. */
  observe(event: AgentStreamEvent): void {
    try {
      this.handle(event);
    } catch (error) {
      this.warn(`failed to record event ${event.type}: ${String(error)}`);
    }
  }

  /**
   * Close any open step and write the completed snapshot. Removes the partial,
   * so a partial left on disk always means "this run never finished".
   */
  async finalize(completion: {
    error?: { message: string; type: string };
    result: HeteroRunResult;
  }): Promise<void> {
    try {
      this.closeLlmStep();
      for (const toolCallId of this.toolSteps.keys()) this.closeToolStep(toolCallId);

      // A run that produced no step and no error has nothing worth a snapshot —
      // writing one anyway fills the store with empty files to page past in
      // `lh trace op list`. A failure with no steps IS worth keeping: "it never
      // got off the ground" is exactly what someone reads a trace to find out.
      const hasContent =
        (this.partial.steps?.length ?? 0) > 0 || this.totalTokens > 0 || !!completion.error;
      if (!hasContent) {
        await this.options.store.removePartial(this.options.operationId);
        return;
      }

      await this.flush();
      await finalizeSnapshot(this.options.store, this.options.operationId, {
        error: completion.error,
        reason:
          completion.result === 'success'
            ? 'done'
            : completion.result === 'cancelled'
              ? 'interrupted'
              : 'error',
        totalCost: this.totalCost,
        totalSteps: this.partial.steps?.length ?? 0,
        // `result_usage` is the authoritative session total, but an interrupted
        // or errored run never reaches it — sum the turns instead, so the trace
        // reports what was actually spent rather than zero.
        totalTokens: this.totalTokens || sumStepTokens(this.partial.steps),
      });
    } catch (error) {
      this.warn(`failed to finalize trace: ${String(error)}`);
    }
  }

  // ─── Event handling ───────────────────────────────────────────────────────

  private handle(event: AgentStreamEvent): void {
    const data = asRecord(event.data);

    // Subagent-scoped events (Claude Code's Task tool) ride the SAME stream as
    // the main agent's, tagged with a `subagent` peer field. Folding them into
    // the main spine would append the child's text to the parent's turn, let
    // the child's usage close that turn early, and surface the child's tools as
    // top-level calls — corrupting the trace precisely for the runs that use
    // Agent/Task. The parent's own `Task` tool step still records the result
    // the child returned, which mirrors how the native runtime keeps a
    // sub-agent's work in its own child operation rather than the parent's.
    if (data.subagent) return;

    switch (event.type) {
      case 'stream_start': {
        // Session opening for Claude Code (emitted once, on `system.init`);
        // per-turn for some other adapters. Either way it starts a turn, and a
        // turn still open at this point never reported its usage — close it so
        // steps stay one-per-turn. Turns after the first are opened lazily by
        // `ensureLlmStep`, which is what makes both conventions segment the
        // same way.
        this.closeLlmStep();
        this.llmStep = {
          content: '',
          events: [],
          model: typeof data.model === 'string' ? data.model : undefined,
          provider: typeof data.provider === 'string' ? data.provider : undefined,
          reasoning: '',
          startedAt: event.timestamp,
          toolsCalling: [],
        };
        return;
      }

      case 'stream_chunk': {
        const step = this.ensureLlmStep(event.timestamp);
        const content = typeof data.content === 'string' ? data.content : '';
        if (!content) return;
        if (data.chunkType === 'text') step.content += content;
        else if (data.chunkType === 'reasoning') step.reasoning += content;
        return;
      }

      case 'step_complete': {
        if (data.phase === 'turn_metadata') {
          const step = this.ensureLlmStep(event.timestamp);
          if (typeof data.model === 'string') step.model = data.model;
          if (typeof data.provider === 'string') step.provider = data.provider;
          this.closeLlmStep(event.timestamp, asRecord(data.usage));
          return;
        }

        if (data.phase === 'result_usage') {
          // Authoritative session grand total — overwrite rather than add, it
          // already covers every turn.
          const usage = asRecord(data.usage);
          if (typeof data.costUsd === 'number') this.totalCost = data.costUsd;
          if (typeof usage.totalTokens === 'number') this.totalTokens = usage.totalTokens;
          this.scheduleWrite();
        }
        return;
      }

      case 'stream_end': {
        this.closeLlmStep(event.timestamp);
        return;
      }

      case 'tool_start': {
        const toolCalling = asRecord(data.toolCalling);
        const toolCallId = typeof toolCalling.id === 'string' ? toolCalling.id : undefined;
        if (!toolCallId) return;

        const identifier = String(toolCalling.identifier ?? '');
        const apiName = String(toolCalling.apiName ?? '');
        // The call is attributed to the LLM turn that produced it, so the trace
        // shows which turn asked for what — then it becomes its own tool step.
        this.llmStep?.toolsCalling.push({
          apiName,
          arguments: typeof toolCalling.arguments === 'string' ? toolCalling.arguments : undefined,
          identifier,
        });
        this.toolSteps.set(toolCallId, {
          apiName,
          arguments: typeof toolCalling.arguments === 'string' ? toolCalling.arguments : undefined,
          identifier,
          startedAt: event.timestamp,
        });
        return;
      }

      case 'tool_result': {
        const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : undefined;
        const step = toolCallId ? this.toolSteps.get(toolCallId) : undefined;
        if (!step) return;
        if (typeof data.content === 'string') step.output = data.content;
        if (typeof data.isError === 'boolean') step.isSuccess = !data.isError;
        return;
      }

      case 'tool_end': {
        const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : undefined;
        if (!toolCallId) return;
        const step = this.toolSteps.get(toolCallId);
        if (step && typeof data.isSuccess === 'boolean') step.isSuccess = data.isSuccess;
        this.closeToolStep(toolCallId, event.timestamp);
        return;
      }

      default: {
        if (!NOTABLE_EVENT_TYPES.has(event.type)) return;
        // Attach to the open turn when there is one; otherwise it would be lost
        // between turns, which is exactly where a terminal error tends to land.
        const step = this.ensureLlmStep(event.timestamp);
        step.events.push({ ...data, timestamp: event.timestamp, type: event.type });
      }
    }
  }

  // ─── Step lifecycle ───────────────────────────────────────────────────────

  private ensureLlmStep(startedAt: number): OpenLlmStep {
    if (!this.llmStep) {
      this.llmStep = {
        content: '',
        events: [],
        reasoning: '',
        startedAt,
        toolsCalling: [],
      };
    }
    return this.llmStep;
  }

  private closeLlmStep(completedAt = Date.now(), usage?: Record<string, any>): void {
    const open = this.llmStep;
    this.llmStep = null;
    if (!open) return;

    // An empty turn carries nothing worth a step row — it happens when a
    // `stream_start` is immediately followed by another one on a retry.
    const isEmpty =
      !open.content &&
      !open.reasoning &&
      open.toolsCalling.length === 0 &&
      open.events.length === 0 &&
      !usage;
    if (isEmpty) return;

    const inputTokens =
      typeof usage?.totalInputTokens === 'number' ? usage.totalInputTokens : undefined;
    const outputTokens =
      typeof usage?.totalOutputTokens === 'number' ? usage.totalOutputTokens : undefined;

    this.pushStep(
      {
        completedAt,
        content: open.content ? truncate(open.content, MAX_CONTENT_CHARS) : undefined,
        events: open.events.length > 0 ? open.events : undefined,
        executionTimeMs: Math.max(0, completedAt - open.startedAt),
        inputTokens,
        outputTokens,
        reasoning: open.reasoning ? truncate(open.reasoning, MAX_CONTENT_CHARS) : undefined,
        startedAt: open.startedAt,
        stepIndex: this.nextStepIndex++,
        stepType: 'call_llm',
        toolsCalling: open.toolsCalling.length > 0 ? open.toolsCalling : undefined,
        totalCost: 0,
        totalTokens: typeof usage?.totalTokens === 'number' ? usage.totalTokens : 0,
      },
      { model: open.model, provider: open.provider },
    );
  }

  private closeToolStep(toolCallId: string, completedAt = Date.now()): void {
    const open = this.toolSteps.get(toolCallId);
    if (!open) return;
    this.toolSteps.delete(toolCallId);

    this.pushStep({
      completedAt,
      executionTimeMs: Math.max(0, completedAt - open.startedAt),
      startedAt: open.startedAt,
      stepIndex: this.nextStepIndex++,
      stepType: 'call_tool',
      toolsResult: [
        {
          apiName: open.apiName,
          identifier: open.identifier,
          isSuccess: open.isSuccess,
          output: open.output ? truncate(open.output, MAX_TOOL_OUTPUT_CHARS) : undefined,
        },
      ],
      totalCost: 0,
      totalTokens: 0,
    });
  }

  private pushStep(step: StepSnapshot, metadata?: { model?: string; provider?: string }): void {
    this.partial.steps ??= [];
    this.partial.steps.push(step);
    // The model id only becomes known once the first turn reports it.
    if (!this.partial.model && metadata?.model) this.partial.model = metadata.model;
    this.scheduleWrite();
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  /**
   * Write the partial without reading it back first.
   *
   * `appendStepToPartial` from the tracing package re-reads the file on every
   * step, which is quadratic over a long CLI run; the recorder already holds
   * the authoritative copy in memory, so it writes straight through. The
   * on-disk format is identical.
   */
  private scheduleWrite(): void {
    this.dirty = true;
    this.writing = this.writing.then(() => this.drain());
  }

  private async drain(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await this.options.store.savePartial(this.options.operationId, this.partial);
    } catch (error) {
      this.warn(`failed to write partial trace: ${String(error)}`);
    }
  }

  private async flush(): Promise<void> {
    this.scheduleWrite();
    await this.writing;
  }

  private warn(message: string): void {
    this.options.onError?.(message);
  }
}

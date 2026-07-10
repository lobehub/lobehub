import type { AgentStreamEvent } from '@lobechat/agent-gateway-client';
import {
  type ExecutionSnapshot,
  type ISnapshotStore,
  parseOperationId,
  type StepSnapshot,
} from '@lobechat/agent-tracing';
import debug from 'debug';

import { buildFinalSnapshotKey } from '@/server/modules/AgentTracing';

const log = debug('lobe-server:hetero-trace-recorder');

export interface HeteroFinalizeParams {
  agentId?: string | null;
  completionReason: 'done' | 'error' | 'interrupted';
  error?: { message: string; type: string };
  topicId?: string | null;
  userId?: string | null;
}

/** Roll-up returned by {@link HeteroTraceRecorder.finalize}, fed into the
 * operation row's aggregate columns by `heteroFinish`. */
export interface HeteroTraceTotals {
  llmCalls: number;
  /** Real executed model, resolved from the CLI's stream_start / turn_metadata
   * (e.g. `claude-opus-4-8`). Null until an event carries it. Lets `heteroFinish`
   * backfill the op row, which `recordStart` can only seed as null at dispatch. */
  model: string | null;
  /** Heterogeneous provider the run executed on (e.g. `claude-code`). Mirrors the
   * provider `recordStart` already seeds, returned so the backfill stays consistent. */
  provider: string | null;
  stepCount: number;
  toolCalls: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  traceS3Key: string;
}

/** Authoritative run-level usage from Claude Code's final `result_usage` event,
 * stashed on the partial so finalize prefers it over summing per-turn steps. */
interface HeteroSessionUsage {
  totalCost?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalTokens?: number;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Hetero-native execution-trace recorder. Unlike the built-in
 * {@link OperationTraceRecorder} — which is coupled to the homogeneous runtime's
 * `AgentState` / `StepPresentationData` — this folds the raw `AgentStreamEvent`
 * stream a heterogeneous CLI (Claude Code / Codex) emits into `StepSnapshot[]`,
 * keyed by `stepIndex`, accumulating across ingest batches in the partial store
 * and finalizing into the same `ExecutionSnapshot` S3 layout the built-in path
 * uses. Context-engine fields are intentionally never set (hetero has no CE).
 */
export class HeteroTraceRecorder {
  constructor(private readonly store: ISnapshotStore | null) {}

  get enabled(): boolean {
    return this.store !== null;
  }

  /** Fold a batch of events into per-stepIndex steps, accumulating into the
   * partial snapshot. Best-effort: tracing must never break ingest. */
  async appendBatch(operationId: string, events: AgentStreamEvent[]): Promise<void> {
    if (!this.store || events.length === 0) return;

    try {
      const partial = (await this.store.loadPartial(operationId)) ?? {};
      if (!partial.steps) partial.steps = [];
      if (!partial.startedAt) partial.startedAt = events[0].timestamp;

      const byIndex = new Map<number, StepSnapshot>();
      for (const s of partial.steps) byIndex.set(s.stepIndex, s);

      for (const event of events) this.applyEvent(partial, byIndex, event);

      await this.store.savePartial(operationId, partial);
    } catch (e) {
      log('[%s] appendBatch failed (non-fatal): %O', operationId, e);
    }
  }

  /** Assemble the final `ExecutionSnapshot` from the partial, persist it, and
   * return the aggregate roll-up for the operation row. */
  async finalize(
    operationId: string,
    params: HeteroFinalizeParams,
  ): Promise<HeteroTraceTotals | null> {
    if (!this.store) return null;

    try {
      const partial = await this.store.loadPartial(operationId);
      if (!partial) return null;

      const steps = (partial.steps ?? []).slice().sort((a, b) => a.stepIndex - b.stepIndex);

      // Prefer the authoritative session totals (CC's final `result_usage`) over
      // summing per-turn steps — summing double-counts (see applyEvent).
      const session = (
        partial as Partial<ExecutionSnapshot> & {
          heteroSessionUsage?: HeteroSessionUsage;
        }
      ).heteroSessionUsage;
      const totalTokens =
        session?.totalTokens ?? steps.reduce((sum, s) => sum + (s.totalTokens || 0), 0);
      const totalInputTokens =
        session?.totalInputTokens ?? steps.reduce((sum, s) => sum + (s.inputTokens || 0), 0);
      const totalOutputTokens =
        session?.totalOutputTokens ?? steps.reduce((sum, s) => sum + (s.outputTokens || 0), 0);
      const totalCost = session?.totalCost ?? steps.reduce((sum, s) => sum + (s.totalCost || 0), 0);

      // Fall back to the agentId/topicId encoded in the operationId when the
      // caller didn't supply them, so the snapshot body and its S3 key never
      // degrade to the literal "unknown" (which also breaks the reader, since
      // it rebuilds the key from the operationId's agt_/tpc_ segments).
      const parsedOp = parseOperationId(operationId);
      const agentId = params.agentId ?? parsedOp?.agentId ?? undefined;
      const topicId = params.topicId ?? parsedOp?.topicId ?? undefined;

      const snapshot: ExecutionSnapshot = {
        agentId,
        completedAt: Date.now(),
        completionReason: params.completionReason,
        error: params.error,
        model: partial.model,
        operationId,
        provider: partial.provider,
        startedAt: partial.startedAt ?? Date.now(),
        steps,
        topicId,
        totalCost,
        totalSteps: steps.length,
        totalTokens,
        traceId: operationId,
        userId: params.userId ?? undefined,
      };

      await this.store.save(snapshot);
      await this.store.removePartial(operationId);

      return {
        llmCalls: steps.filter((s) => s.stepType === 'call_llm').length,
        model: partial.model ?? null,
        provider: partial.provider ?? null,
        stepCount: steps.length,
        toolCalls: steps.filter((s) => s.stepType === 'call_tool').length,
        totalCost,
        totalInputTokens,
        totalOutputTokens,
        totalTokens,
        traceS3Key: buildFinalSnapshotKey(agentId ?? 'unknown', topicId ?? 'unknown', operationId),
      };
    } catch (e) {
      log('[%s] finalize failed (non-fatal): %O', operationId, e);
      return null;
    }
  }

  private applyEvent(
    partial: Partial<ExecutionSnapshot>,
    byIndex: Map<number, StepSnapshot>,
    event: AgentStreamEvent,
  ): void {
    const data = (event.data ?? {}) as Record<string, any>;

    // Header: capture model / provider from the first event that carries them
    // (stream_start, step_complete). Mirrors initPartialHeader in the built-in
    // recorder so the trace + S3 key resolve to the right model.
    if (!partial.model) partial.model = str(data.model);
    if (!partial.provider) partial.provider = str(data.provider);

    let step = byIndex.get(event.stepIndex);
    if (!step) {
      step = {
        completedAt: event.timestamp,
        executionTimeMs: 0,
        startedAt: event.timestamp,
        stepIndex: event.stepIndex,
        stepType: 'call_llm',
        totalCost: 0,
        totalTokens: 0,
      };
      byIndex.set(event.stepIndex, step);
      partial.steps!.push(step);
    }

    step.startedAt = Math.min(step.startedAt, event.timestamp);
    step.completedAt = Math.max(step.completedAt, event.timestamp);
    step.executionTimeMs = step.completedAt - step.startedAt;

    switch (event.type) {
      case 'stream_chunk': {
        if (data.chunkType === 'text' && typeof data.content === 'string') {
          step.content = (step.content ?? '') + data.content;
        } else if (data.chunkType === 'reasoning' && typeof data.reasoning === 'string') {
          step.reasoning = (step.reasoning ?? '') + data.reasoning;
        } else if (data.chunkType === 'tools_calling' && Array.isArray(data.toolsCalling)) {
          step.stepType = 'call_tool';
          step.toolsCalling = data.toolsCalling.map((t: any) => ({
            apiName: str(t?.apiName) ?? '',
            arguments: str(t?.arguments),
            identifier: str(t?.identifier) ?? str(t?.id) ?? '',
          }));
        }
        break;
      }
      case 'tool_start':
      case 'tool_execute': {
        step.stepType = 'call_tool';
        break;
      }
      case 'tool_end': {
        step.stepType = 'call_tool';
        const tool = (data.toolCalling ?? {}) as Record<string, unknown>;
        step.toolsResult = [
          ...(step.toolsResult ?? []),
          {
            apiName: str(tool.apiName) ?? '',
            identifier: str(tool.identifier) ?? str(data.toolCallId) ?? '',
            isSuccess: typeof data.isSuccess === 'boolean' ? data.isSuccess : undefined,
            output: str(data.result),
          },
        ];
        break;
      }
      case 'tool_result': {
        step.stepType = 'call_tool';
        step.toolsResult = [
          ...(step.toolsResult ?? []),
          {
            apiName: '',
            identifier: str(data.toolCallId) ?? '',
            isSuccess: data.isError ? false : true,
            output: str(data.content),
          },
        ];
        break;
      }
      case 'step_complete': {
        const usage = data.usage as Record<string, unknown> | undefined;
        const inT = usage ? num(usage.totalInputTokens) : undefined;
        const outT = usage ? num(usage.totalOutputTokens) : undefined;
        const tot = usage ? num(usage.totalTokens) : undefined;
        const cost = num(data.costUsd);

        // Claude Code emits one `turn_metadata` per turn (incremental usage) and
        // a single final `result_usage` carrying the authoritative SESSION
        // totals. Folding `result_usage` onto a step then summing steps at
        // finalize double-counts (per-turn turns + the grand total). So route
        // `result_usage` to a run-level field and only fold turn_metadata steps.
        if (data.phase === 'result_usage') {
          const target = partial as Partial<ExecutionSnapshot> & {
            heteroSessionUsage?: HeteroSessionUsage;
          };
          target.heteroSessionUsage = {
            totalCost: cost ?? target.heteroSessionUsage?.totalCost,
            totalInputTokens: inT ?? target.heteroSessionUsage?.totalInputTokens,
            totalOutputTokens: outT ?? target.heteroSessionUsage?.totalOutputTokens,
            totalTokens:
              tot ??
              (inT !== undefined || outT !== undefined
                ? (inT ?? 0) + (outT ?? 0)
                : target.heteroSessionUsage?.totalTokens),
          };
          break;
        }

        if (inT !== undefined) step.inputTokens = inT;
        if (outT !== undefined) step.outputTokens = outT;
        if (tot !== undefined) step.totalTokens = tot;
        else if (inT !== undefined || outT !== undefined)
          step.totalTokens = (inT ?? 0) + (outT ?? 0);
        if (cost !== undefined) step.totalCost = cost;
        break;
      }
      default: {
        break;
      }
    }
  }
}

import type { Span } from '@lobechat/observability-otel/api';
import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer as agentRuntimeTracer } from '@lobechat/observability-otel/modules/agent-runtime';

export type StageTracer = <T>(stage: string, fn: (span: Span) => Promise<T>) => Promise<T>;

/**
 * Build a span wrapper for one family of send-path stages. Every stage of the
 * family shares a name prefix (`tool_discovery connectors`,
 * `execAgent turn_setup`, …) so a trace reads as a timeline of where the
 * user waited between pressing send and the operation starting.
 *
 * The wrapper only records a failure when the callback throws: a stage that
 * absorbs its own errors must mark the span itself (see `markDegradedStage`).
 */
export const createStageTracer =
  (family: string): StageTracer =>
  (stage, fn) =>
    agentRuntimeTracer.startActiveSpan(`${family} ${stage}`, async (span) => {
      try {
        return await fn(span);
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error)?.message });
        throw error;
      } finally {
        span.end();
      }
    });

export interface OpenStageSpan {
  /** Close the span; pass the error when the stage failed. */
  end: (error?: unknown) => void;
  span: Span;
}

/**
 * Open a span over a stretch of straight-line code that cannot be wrapped in
 * a callback (a block with early returns, a branch that assigns outer
 * variables). The span is NOT made active, so nested stages attach to the
 * enclosing request span instead of this one; it is a timing mark, not a
 * parent. The caller owns `end()` — every exit path must reach it.
 */
export const openStageSpan =
  (family: string) =>
  (stage: string): OpenStageSpan => {
    const span = agentRuntimeTracer.startSpan(`${family} ${stage}`);
    return {
      end: (error) => {
        if (error) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error)?.message });
        }
        span.end();
      },
      span,
    };
  };

/**
 * The top-level stages of `execAgent`: agent config, the approval claim, turn
 * setup (rows + attachments), the init stage (discovery + prep) and operation
 * start. Postgres and Redis carry no spans of their own, so these are the
 * only breakdown of the untraced stretches before discovery and after it.
 */
export const traceSendStage = createStageTracer('execAgent');

/** The serial reads of `prepareOperation` (persona, history, workspace scan, skills, …). */
export const tracePrepStage = createStageTracer('operation_prep');

/** The persistence steps of `createOperation` (row, runtime meta + gateway init, state, queue). */
export const traceStartStage = createStageTracer('operation_start');

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

export interface StageMark {
  /** Close the span. Call from `finally` so every exit path reaches it. */
  end: () => void;
  /** Record the error that is about to propagate; call from `catch` before rethrowing. */
  fail: (error: unknown) => void;
}

/**
 * A span over a block that cannot be wrapped in a callback: one that assigns
 * the enclosing function's narrowed bindings (TypeScript drops a `let`'s
 * narrowing for every later read once a closure assigns it). The caller
 * owns the lifecycle and must shape it as
 * `try { … } catch (e) { mark.fail(e); throw e; } finally { mark.end(); }`,
 * so a throw on any path still records the error and closes the span. The
 * span is not made active; nested stages attach to the enclosing one.
 */
export const openStageMark =
  (family: string) =>
  (stage: string): StageMark => {
    const span = agentRuntimeTracer.startSpan(`${family} ${stage}`);
    return {
      end: () => span.end(),
      fail: (error) =>
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error)?.message }),
    };
  };

/**
 * The top-level stages of `execAgent`: agent config, the approval claim, turn
 * setup (rows + attachments), the init stage (discovery + prep) and operation
 * start. Postgres and Redis carry no spans of their own, so these are the
 * only breakdown of the untraced stretches before discovery and after it.
 *
 * Stages are wrapped where they are a call, and marked (`openStageMark`,
 * inside try/catch/finally) where they are a block that assigns the
 * function's narrowed bindings; either way every exit records the error
 * and closes the span.
 */
export const traceSendStage = createStageTracer('execAgent');

/** The serial reads of `prepareOperation` (persona, history, workspace scan, skills, …). */
export const tracePrepStage = createStageTracer('operation_prep');

/** The persistence steps of `createOperation` (row, runtime meta + gateway init, state, queue). */
export const traceStartStage = createStageTracer('operation_start');

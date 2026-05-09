import { SpanStatusCode } from '@lobechat/observability-otel/api';
import { tracer } from '@lobechat/observability-otel/modules/agent-signal';

import type { NightlyReviewContext } from './nightlyCollector';
import type { MaintenanceTools } from './tools';
import type { MaintenancePlan, MaintenanceReviewRunResult } from './types';
import { MaintenanceReviewScope, ReviewRunStatus } from './types';

/** Default step budget for one nightly maintenance agent run. */
const DEFAULT_MAX_MAINTENANCE_AGENT_STEPS = 10;

/**
 * Result envelope returned by the bounded maintenance agent runner.
 */
export interface MaintenanceAgentRunResult {
  /** Executed tool or legacy executor result to persist as receipts. */
  execution: MaintenanceReviewRunResult;
  /** Frozen deterministic plan used for Daily Brief proposal projection. */
  projectionPlan: MaintenancePlan;
  /** Optional number of agent/tool steps consumed by the backend runner. */
  stepCount?: number;
}

/**
 * Input passed to a maintenance runner backend.
 */
export interface MaintenanceAgentRunnerRunInput {
  /** Bounded digest context collected for one nightly review window. */
  context: NightlyReviewContext;
  /** User-local nightly date used in projected maintenance plans. */
  localDate?: string;
  /** Maximum backend agent/tool steps allowed for this run. */
  maxSteps: number;
  /** Review scope attached to projected plans and tracing. */
  reviewScope: MaintenanceReviewScope;
  /** Stable source id used to generate action idempotency keys. */
  sourceId: string;
  /** Safe read/write tools available to the backend runner. */
  tools: MaintenanceTools;
  /** Stable user id owning this run. */
  userId: string;
}

/**
 * Options for creating a bounded maintenance agent runner.
 */
export interface MaintenanceAgentRunnerOptions {
  /**
   * Maximum backend agent/tool steps.
   *
   * @default 10
   */
  maxSteps?: number;
  /** Backend implementation that may call tools and must return a projected plan. */
  run: (input: MaintenanceAgentRunnerRunInput) => Promise<MaintenanceAgentRunResult>;
  /** Safe tools exposed to the backend implementation. */
  tools: MaintenanceTools;
}

/**
 * Input for one bounded nightly maintenance run.
 */
export interface MaintenanceAgentRunnerInput {
  /** Bounded digest context collected for one nightly review window. */
  context: NightlyReviewContext;
  /** User-local nightly date used in projected maintenance plans. */
  localDate?: string;
  /** Stable source id used to generate action idempotency keys. */
  sourceId: string;
  /** Stable user id owning this run. */
  userId: string;
}

const createFailedProjectionPlan = (input: MaintenanceAgentRunnerInput): MaintenancePlan => ({
  actions: [],
  localDate: input.localDate,
  plannerVersion: 'maintenance-agent-runner-fallback-v1',
  reviewScope: MaintenanceReviewScope.Nightly,
  summary: 'Maintenance review runner failed before producing a valid plan.',
});

/**
 * Creates a bounded runner for nightly maintenance agent execution.
 *
 * Call stack:
 *
 * createNightlyReviewSourceHandler
 *   -> {@link createMaintenanceAgentRunner}
 *     -> injected `run`
 *       -> safe maintenance tools
 *
 * Use when:
 * - Nightly self-review should execute through one bounded runner boundary
 * - Tests need to verify fallback and source-id normalization without DB or LLMs
 *
 * Expects:
 * - `sourceId` is stable for idempotency
 * - The backend `run` returns both execution output and the frozen projection plan
 *
 * Returns:
 * - A runner that traces the run, injects tools, enforces the configured step budget, and
 *   returns a conservative failed result if the backend cannot produce a result
 */
export const createMaintenanceAgentRunner = (options: MaintenanceAgentRunnerOptions) => {
  const maxSteps = Math.max(1, options.maxSteps ?? DEFAULT_MAX_MAINTENANCE_AGENT_STEPS);

  return {
    run: async (input: MaintenanceAgentRunnerInput): Promise<MaintenanceAgentRunResult> =>
      tracer.startActiveSpan(
        'agent_signal.maintenance_agent.runner.run',
        {
          attributes: {
            'agent.signal.agent_id': input.context.agentId,
            'agent.signal.maintenance_agent.max_steps': maxSteps,
            'agent.signal.review_scope': MaintenanceReviewScope.Nightly,
            'agent.signal.source_id': input.sourceId,
            'agent.signal.user_id': input.userId,
          },
        },
        async (span) => {
          try {
            const result = await options.run({
              ...input,
              maxSteps,
              reviewScope: MaintenanceReviewScope.Nightly,
              tools: options.tools,
            });
            const execution = {
              ...result.execution,
              sourceId: result.execution.sourceId ?? input.sourceId,
            };

            span.setAttribute(
              'agent.signal.maintenance_agent.plan_action_count',
              result.projectionPlan.actions.length,
            );
            span.setAttribute(
              'agent.signal.maintenance_agent.execution_action_count',
              execution.actions.length,
            );
            if (typeof result.stepCount === 'number') {
              span.setAttribute('agent.signal.maintenance_agent.step_count', result.stepCount);
            }
            span.setStatus({ code: SpanStatusCode.OK });

            return {
              ...result,
              execution,
            };
          } catch (error) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message:
                error instanceof Error
                  ? error.message
                  : 'AgentSignal maintenance agent runner failed',
            });
            span.recordException(error as Error);

            return {
              execution: {
                actions: [],
                sourceId: input.sourceId,
                status: ReviewRunStatus.Failed,
              },
              projectionPlan: createFailedProjectionPlan(input),
              stepCount: maxSteps,
            };
          } finally {
            span.end();
          }
        },
      ),
  };
};

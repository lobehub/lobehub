import debug from 'debug';

import { getServerDB } from '@/database/server';
import type { GeneratedAgentSignalEmissionResult } from '@/server/services/agentSignal';
import { executeAgentSignalSourceEvent } from '@/server/services/agentSignal';
import { createRedisRuntimeGuardBackend } from '@/server/services/agentSignal/runtime/backend/redisGuard';

import type { AgentSignalWorkflowRunPayload } from './index';

const log = debug('lobe-server:workflows:agent-signal:run');

const isGeneratedEmission = (
  value: Awaited<ReturnType<typeof executeAgentSignalSourceEvent>> | undefined,
): value is GeneratedAgentSignalEmissionResult => {
  return Boolean(value && !value.deduped);
};

/**
 * Minimal workflow context contract used by the Agent Signal workflow runner.
 *
 * @param TPayload - Workflow request payload type.
 */
export interface AgentSignalWorkflowContext<TPayload = AgentSignalWorkflowRunPayload> {
  requestPayload?: TPayload;
  run: <TResult>(stepId: string, handler: () => Promise<TResult>) => Promise<TResult>;
}

/** Dependencies for executing one Agent Signal workflow payload. */
export interface RunAgentSignalWorkflowDeps {
  createRuntimeGuardBackend?: typeof createRedisRuntimeGuardBackend;
  executeSourceEvent?: typeof executeAgentSignalSourceEvent;
  getDb?: typeof getServerDB;
}

/**
 * Runs one normalized Agent Signal source event inside the workflow worker.
 *
 * Use when:
 * - The Next.js Upstash route needs a plain function for testable execution
 * - Tests or local harnesses need the exact workflow worker logic without HTTP indirection
 *
 * Expects:
 * - `context.requestPayload` contains `userId` and one normalized `sourceEvent`
 *
 * Returns:
 * - A small execution summary mirroring the workflow route response
 */
export const runAgentSignalWorkflow = async (
  context: AgentSignalWorkflowContext,
  deps: RunAgentSignalWorkflowDeps = {},
) => {
  const payload = context.requestPayload;

  if (!payload?.userId || !payload.sourceEvent) {
    return { error: 'Missing userId or sourceEvent', success: false } as const;
  }

  log('Worker received payload=%O', payload);

  const getDb = deps.getDb ?? getServerDB;
  const executeSourceEvent = deps.executeSourceEvent ?? executeAgentSignalSourceEvent;
  const createGuardBackend = deps.createRuntimeGuardBackend ?? createRedisRuntimeGuardBackend;

  const db = await getDb();
  const result = await context.run(
    `agent-signal:execute:${payload.sourceEvent.sourceType}:${payload.sourceEvent.sourceId}`,
    () =>
      executeSourceEvent(
        payload.sourceEvent,
        {
          agentId: payload.agentId,
          db,
          userId: payload.userId,
        },
        {
          runtimeGuardBackend: createGuardBackend(),
        },
      ),
  );

  log('Processed source event result=%O', {
    deduped: result?.deduped ?? true,
    orchestration:
      result && !result.deduped
        ? {
            actionTypes: result.orchestration.actions.map((action) => action.actionType),
            resultStatuses: result.orchestration.results.map((item) => item.status),
            runtimeStatus:
              'runtimeResult' in result.orchestration
                ? result.orchestration.runtimeResult.status
                : undefined,
            signalTypes: result.orchestration.emittedSignals.map((signal) => signal.signalType),
          }
        : undefined,
    scopeKey: payload.sourceEvent.scopeKey,
    sourceId: payload.sourceEvent.sourceId,
    sourceType: payload.sourceEvent.sourceType,
  });

  return {
    deduped: result?.deduped ?? true,
    emittedSignals: isGeneratedEmission(result) ? result.orchestration.emittedSignals.length : 0,
    scopeKey: payload.sourceEvent.scopeKey,
    sourceId: payload.sourceEvent.sourceId,
    success: true,
  } as const;
};

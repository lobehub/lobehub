import debug from 'debug';

import { appEnv } from '@/envs/app';
import { injectActiveTraceHeaders } from '@/libs/observability/traceparent';

import type { AgentSignalWorkflowRunPayload } from './types';

export type { AgentSignalWorkflowRunPayload, AgentSignalWorkflowSourceEventInput } from './types';

const log = debug('lobe-server:workflows:agent-signal');

const WORKFLOW_PATHS = {
  run: '/api/workflows/agent-signal/run',
} as const;

const localRunQueues = new Map<string, Promise<void>>();

const normalizeFlowControlKeySegment = (value: string) => {
  return value.replaceAll(/[^\w.-]/g, '_');
};

const deferLocalRun = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const scheduleLocalRun = (
  payload: AgentSignalWorkflowRunPayload,
  headers: Headers,
): { workflowRunId: string } => {
  const workflowRunId = `local-${payload.sourceEvent.sourceId}`;
  const logContext = {
    agentId: payload.agentId,
    sourceId: payload.sourceEvent.sourceId,
    userId: payload.userId,
    workflowRunId,
  };

  /**
   * Local Agent Runtime deliberately avoids QStash. Defer execution so the ingress request can
   * return before the Agent Signal pipeline starts, matching the foreground/background boundary
   * of Upstash Workflow without pretending to provide its durability guarantees. Runs sharing a
   * scope are chained here to preserve the queue runtime's `parallelism: 1` behavior; otherwise a
   * later local event can hit the first run's scope lock and be dropped instead of waiting.
   */
  log('Scheduling local workflow payload=%O', logContext);

  const previousRun = localRunQueues.get(payload.sourceEvent.scopeKey) ?? Promise.resolve();
  const currentRun = previousRun
    .catch(() => undefined)
    .then(deferLocalRun)
    .then(async () => {
      try {
        const [
          { executeAgentSignalSourceEvent },
          { inMemorySourceEventStore },
          { inMemoryRuntimeGuardBackend },
          { runAgentSignalWorkflow },
        ] = await Promise.all([
          import('@/server/services/agentSignal/orchestrator'),
          import('@/server/services/agentSignal/store/adapters/memory/sourceEventStore'),
          import('@/server/services/agentSignal/runtime/backend/memoryGuard'),
          import('./run'),
        ]);

        await runAgentSignalWorkflow(
          {
            headers,
            requestPayload: payload,
            run: async (_stepId, handler) => handler(),
          },
          {
            createRuntimeGuardBackend: () => inMemoryRuntimeGuardBackend,
            executeSourceEvent: (input, context, options) =>
              executeAgentSignalSourceEvent(input, context, {
                ...options,
                store: inMemorySourceEventStore,
              }),
          },
        );
      } catch (error) {
        console.error('[AgentSignal] Local workflow execution failed:', {
          ...logContext,
          error,
        });
      }
    });

  localRunQueues.set(payload.sourceEvent.scopeKey, currentRun);

  void currentRun.finally(() => {
    if (localRunQueues.get(payload.sourceEvent.scopeKey) === currentRun) {
      localRunQueues.delete(payload.sourceEvent.scopeKey);
    }
  });

  return { workflowRunId };
};

const getWorkflowUrl = (path: string): string => {
  const baseUrl = appEnv.INTERNAL_APP_URL || appEnv.APP_URL;

  if (!baseUrl) {
    throw new Error('INTERNAL_APP_URL or APP_URL is required to trigger agent signal workflows');
  }

  return new URL(path, baseUrl).toString();
};

/**
 * Agent Signal workflow trigger helper.
 *
 * Use when:
 * - Server-owned ingress wants to hand off execution to the configured background runtime
 * - The caller already normalized the source event
 *
 * Expects:
 * - `sourceEvent.scopeKey` is stable for the policy coordination scope
 *
 * Returns:
 * - Queue mode returns Upstash workflow trigger metadata
 * - Local mode returns a synthetic `workflowRunId` and executes in-process without durability
 */
export class AgentSignalWorkflow {
  static async triggerRun(payload: AgentSignalWorkflowRunPayload) {
    const traceHeaders = new Headers();

    // NOTICE:
    // Upstash Workflow/QStash only forwards user headers to the workflow destination when they
    // are sent through the SDK's `headers` option, which the SDK rewrites into
    // `Upstash-Forward-*` headers under the hood.
    // Source/context:
    // - Upstash docs: workflow trigger + QStash receiving docs describe `Upstash-Forward-*`
    // - Local SDK source (`@upstash/workflow`) rewrites `headers` to `Upstash-Forward-*`
    // Removal condition:
    // - Safe to simplify only if Upstash adds native trace-context propagation for workflow
    //   triggers or we stop relying on Workflow/QStash as the async hop.
    injectActiveTraceHeaders(traceHeaders);

    if (!appEnv.enableQueueAgentRuntime) {
      return scheduleLocalRun(payload, traceHeaders);
    }

    const url = getWorkflowUrl(WORKFLOW_PATHS.run);
    const { workflowClient } = await import('@/libs/qstash');

    log('Triggering run workflow payload=%O', {
      agentId: payload.agentId,
      headers: Object.fromEntries(traceHeaders.entries()),
      sourceEvent: payload.sourceEvent,
      url,
      userId: payload.userId,
    });

    return workflowClient.trigger({
      body: payload,
      flowControl: {
        // NOTICE:
        // Upstash QStash flow control keys reject `:` and other scope-key delimiters used by
        // AgentSignal. We normalize only the flow-control segment here so runtime scope keys can
        // keep their richer shape everywhere else.
        // Source/context:
        // - Local smoke trigger against real QStash returned:
        //   `flowControlKey must be alphanumeric, hyphen, underscore, or period`
        // - `payload.sourceEvent.scopeKey` commonly contains delimiters like `topic:...`
        // Removal condition:
        // - Safe to remove only if Upstash broadens flow-control key validation.
        key: `agent-signal.run.scope.${normalizeFlowControlKeySegment(payload.sourceEvent.scopeKey)}`,
        parallelism: 1,
      },
      headers: Object.fromEntries(traceHeaders.entries()),
      url,
    });
  }
}

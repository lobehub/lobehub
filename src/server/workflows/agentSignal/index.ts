import type { AgentSignalSourceEvent, AgentSignalSourceType } from '@lobechat/agent-signal/source';
import debug from 'debug';

import { appEnv } from '@/envs/app';
import { injectActiveTraceHeaders } from '@/libs/observability/traceparent';
import { workflowClient } from '@/libs/qstash';

const log = debug('lobe-server:workflows:agent-signal');

const WORKFLOW_PATHS = {
  run: '/api/workflows/agent-signal/run',
} as const;

const normalizeFlowControlKeySegment = (value: string) => {
  return value.replaceAll(/[^\w.-]/g, '_');
};

type AgentSignalWorkflowSourceType = AgentSignalSourceType;

/** One normalized Agent Signal source event handed to the workflow worker. */
export interface AgentSignalWorkflowSourceEventInput<
  TSourceType extends AgentSignalWorkflowSourceType = AgentSignalWorkflowSourceType,
> extends AgentSignalSourceEvent<TSourceType> {}

/** One Upstash workflow payload for Agent Signal execution. */
export interface AgentSignalWorkflowRunPayload {
  agentId?: string;
  sourceEvent: AgentSignalWorkflowSourceEventInput;
  userId: string;
}

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
 * - Server-owned ingress wants to hand off execution to Upstash Workflow
 * - The caller already normalized the source event
 *
 * Expects:
 * - `sourceEvent.scopeKey` is stable for the policy coordination scope
 *
 * Returns:
 * - Upstash workflow trigger metadata including `workflowRunId`
 */
export class AgentSignalWorkflow {
  static triggerRun(payload: AgentSignalWorkflowRunPayload) {
    const url = getWorkflowUrl(WORKFLOW_PATHS.run);
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

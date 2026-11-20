import {
  type AgentSignalSourceType,
  createSourceEvent,
  getSourceEventScopeKey,
} from '@lobechat/agent-signal/source';
import debug from 'debug';

import { getServerDB } from '@/database/server';
import { assertAgentUsableBy } from '@/database/utils/agent-access';
import { AgentSignalWorkflow } from '@/server/workflows/agentSignal';

import type { AgentSignalExecutionContext, AgentSignalSourceEventInput } from './emitter';
import { isAgentSignalScenarioEnabled } from './scenarios/meta';

const log = debug('lobe-server:agent-signal:service');

/** One AgentSignal async handoff result. */
export interface QueuedAgentSignalEmissionResult {
  accepted: boolean;
  scopeKey: string;
  workflowRunId: string;
}

/**
 * Enqueues one source event for async AgentSignal execution through Upstash Workflow.
 *
 * Use when:
 * - The caller should return quickly and let async policy execution happen out-of-band
 * - The source event should still reuse the normal AgentSignal normalization boundary
 *
 * Expects:
 * - Payload contains enough routing context to derive a stable scope key
 *
 * Returns:
 * - The accepted workflow run identifier and normalized scope key
 *
 * Kept in its own module on purpose: `procedure/*` needs this handoff, and importing
 * it from `emitter` would drag `orchestrator` into that low-level graph and close a
 * circular dependency (`procedure` → `emitter` → `orchestrator` → `policies` → `procedure`).
 */
export const enqueueAgentSignalSourceEvent = async <TSourceType extends AgentSignalSourceType>(
  input: AgentSignalSourceEventInput<TSourceType>,
  context: Pick<AgentSignalExecutionContext, 'agentId' | 'userId' | 'workspaceId'>,
): Promise<QueuedAgentSignalEmissionResult> => {
  const db = await getServerDB();

  // Reject signals targeting an agent the caller can't use. Source events from
  // user-facing TRPC routes (`emitSourceEvent` / `triggerSourceEvent`) accept a
  // free-form `agentId`; without this gate a workspace member could enqueue
  // events against another user's private agent. Server-internal callers always
  // pass an agentId the user owns, so the check is a no-op for them.
  if (context.agentId) {
    await assertAgentUsableBy(db, context.agentId, {
      userId: context.userId,
      workspaceId: context.workspaceId,
    });
  }

  if (!(await isAgentSignalScenarioEnabled('self-iteration', { db, userId: context.userId }))) {
    return {
      accepted: false,
      scopeKey: input.scopeKey ?? getSourceEventScopeKey(input.payload),
      workflowRunId: '',
    };
  }

  const sourceEvent = createSourceEvent(input);

  log('Enqueueing source event payload=%O', {
    agentId: context.agentId,
    payload: sourceEvent.payload,
    scopeKey: sourceEvent.scopeKey,
    sourceId: sourceEvent.sourceId,
    sourceType: sourceEvent.sourceType,
    timestamp: sourceEvent.timestamp,
    userId: context.userId,
  });

  const trigger = await AgentSignalWorkflow.triggerRun({
    agentId: context.agentId,
    sourceEvent,
    userId: context.userId,
    workspaceId: context.workspaceId,
  });

  return {
    accepted: true,
    scopeKey: sourceEvent.scopeKey,
    workflowRunId: trigger.workflowRunId,
  };
};

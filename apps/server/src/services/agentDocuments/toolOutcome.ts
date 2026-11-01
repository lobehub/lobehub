import { AgentDocumentsIdentifier } from '@lobechat/builtin-tool-agent-documents';

import {
  emitToolOutcomeSafely,
  resolveToolOutcomeScope,
} from '@/server/services/agentSignal/procedure';
import { redisPolicyStateStore } from '@/server/services/agentSignal/store/adapters/redis/policyStateStore';

/** Tool outcome retention window for agent document procedure state. */
const AGENT_DOCUMENT_TOOL_OUTCOME_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Input for emitting an agent document tool outcome.
 */
export interface EmitAgentDocumentToolOutcomeInput {
  /** Agent document binding id related to the tool outcome. */
  agentDocumentId?: string;
  /** Agent id used to scope the outcome when available. */
  agentId?: string;
  /** Tool API method name that produced the outcome. */
  apiName: string;
  /** Compact failure reason for failed outcomes. */
  errorReason?: string;
  /** Whether the document was hinted as reusable skill material. */
  hintIsSkill?: boolean;
  /** Message id associated with the tool call when known. */
  messageId?: string;
  /** Operation id associated with the tool call when known. */
  operationId?: string;
  /** Relationship between the tool outcome and the agent document. */
  relation?: string;
  /** Outcome status produced by the tool execution. */
  status: 'failed' | 'succeeded';
  /** Compact human-readable outcome summary. */
  summary: string;
  /** Task id used to scope the outcome, or null when explicitly absent. */
  taskId?: string | null;
  /** Tool action such as create, update, copy, or replace. */
  toolAction: string;
  /** Tool call id associated with the outcome when known. */
  toolCallId?: string;
  /** Topic id used to scope the outcome when available. */
  topicId?: string;
  /** User id that owns the tool outcome. */
  userId: string;
}

/**
 * Emits an agent document tool outcome through Agent Signal.
 *
 * Use when:
 * - Agent document server tools need to record a direct persistence outcome
 * - Planner suppression needs same-turn procedure state for document changes
 *
 * Expects:
 * - `userId` is present and matches the executing user
 * - `agentDocumentId`, when provided, is the agent document binding id
 *
 * Returns:
 * - A promise that settles after safe outcome emission completes
 */
export const emitAgentDocumentToolOutcomeSafely = async (
  input: EmitAgentDocumentToolOutcomeInput,
) => {
  const { agentId, topicId, userId } = input;
  const { scope, scopeKey } = resolveToolOutcomeScope({
    agentId,
    taskId: input.taskId ?? undefined,
    topicId,
    userId,
  });

  await emitToolOutcomeSafely({
    apiName: input.apiName,
    context: { agentId, userId },
    domainKey: 'document:agent-document',
    errorReason: input.errorReason,
    identifier: AgentDocumentsIdentifier,
    intentClass: input.hintIsSkill ? 'hinted_skill_document' : 'explicit_persistence',
    messageId: input.messageId,
    operationId: input.operationId,
    policyStateStore: redisPolicyStateStore,
    relatedObjects: input.agentDocumentId
      ? [
          {
            objectId: input.agentDocumentId,
            objectType: 'agent-document',
            relation: input.relation,
          },
        ]
      : undefined,
    scope,
    scopeKey,
    status: input.status,
    summary: input.summary,
    ttlSeconds: AGENT_DOCUMENT_TOOL_OUTCOME_TTL_SECONDS,
    toolAction: input.toolAction,
    toolCallId: input.toolCallId,
  });
};

import type { MessageMapScope } from '@lobechat/types';

export type AgentInterventionReviewStatus =
  | 'approved'
  | 'cancelled'
  | 'mixed'
  | 'pending'
  | 'rejected'
  | 'resolving'
  | 'resolved'
  | 'session_ended'
  | 'skipped'
  | 'stopped'
  | 'timed_out'
  | 'unavailable';

export type AgentInterventionAllowedAction =
  | 'approve_tool'
  | 'approve_tool_remember'
  | 'cancel_interaction'
  | 'edit_arguments'
  | 'reject_continue'
  | 'select_provider_option'
  | 'skip_interaction'
  | 'stop'
  | 'submit_answers'
  | 'submit_custom';

export interface AgentInterventionRequestRevision {
  hash: string;
  version: number;
}

export interface AgentInterventionReviewAuthorization {
  canResolve: boolean;
  canView: boolean;
  denialReason?: 'permission' | 'stale' | 'view_only';
}

export interface AgentInterventionReviewContext {
  /** ACL-hydrated display metadata; never copied from a notification payload. */
  agent?: { avatar?: string; title?: string };
  agentId?: string;
  assistantMessageId?: string;
  groupId?: string;
  operationId: string;
  pageId?: string;
  scope?: MessageMapScope;
  sessionId?: string;
  taskId?: string;
  threadId?: string;
  /** ACL-hydrated display metadata; never copied from a notification payload. */
  topic?: { title?: string };
  topicId?: string;
  triggerMessageId?: string;
  /** Hydrated and bounded only after ACL; never stored in notification rows. */
  triggerRequest?: { messageId: string; text?: string };
  workspaceId?: string;
}

export interface AgentInterventionReviewOption {
  description?: string;
  id: string;
  label: string;
}

export interface AgentInterventionReviewQuestion {
  allowCustomAnswer?: boolean;
  header?: string;
  id: string;
  multiple?: boolean;
  options: AgentInterventionReviewOption[];
  question: string;
}

export interface AgentMarketplaceReviewAgent {
  avatar?: string;
  description?: string;
  id: string;
  title: string;
}

export type AgentInterventionReviewDetail =
  | {
      /** Hydrated only after the context ACL succeeds; never copied into notification storage. */
      arguments?: Record<string, unknown>;
      description?: string;
      title: string;
      type: 'tool_approval';
    }
  | {
      answerPolicy?: { allowFreeform?: boolean; allowSupplement?: boolean };
      questions: AgentInterventionReviewQuestion[];
      title?: string;
      type: 'question';
    }
  | {
      description?: string;
      options: AgentInterventionReviewOption[];
      title: string;
      type: 'permission';
    }
  | {
      content: string;
      options?: AgentInterventionReviewOption[];
      title: string;
      type: 'plan';
    }
  | {
      agents: AgentMarketplaceReviewAgent[];
      kind: 'agent_marketplace';
      multiple: true;
      selectedIds?: string[];
      title: string;
      type: 'custom';
    };

export interface AgentInterventionRisk {
  level: 'critical' | 'high' | 'low' | 'medium' | 'none';
  summary: string;
  warnings?: string[];
}

export interface AgentInterventionReviewItem {
  allowedActions: AgentInterventionAllowedAction[];
  detail: AgentInterventionReviewDetail;
  id: string;
  interactionKind: 'custom' | 'permission' | 'plan' | 'question' | 'tool_approval';
  requestRevision: AgentInterventionRequestRevision;
  risk?: AgentInterventionRisk;
  source: 'heterogeneous' | 'runtime';
  /** Per-item state; batch status alone is insufficient for partially resolved turns. */
  status: AgentInterventionReviewStatus;
  surface: 'binary' | 'form';
}

export interface AgentInterventionReviewBatch {
  /** Only actions valid for the batch as a whole. Per-item actions live on each item. */
  allowedActions: AgentInterventionAllowedAction[];
  id: string;
  itemIds: string[];
  kind: 'mixed' | 'parallel' | 'single';
  version: number;
}

export interface AgentInterventionReviewV2 {
  batch: AgentInterventionReviewBatch;
  context: AgentInterventionReviewContext;
  deadline?: number;
  id: string;
  items: AgentInterventionReviewItem[];
  summary: string;
  /** Persisted server assertion; clients must never infer this from item shape or risk. */
  systemActionEligibility: 'review_only' | 'safe_single_binary';
}

export interface GetAgentInterventionReviewParams {
  reviewToken: string;
  userId: string;
  workspaceId?: string;
}

export interface GetAgentInterventionReviewResult {
  authorization: AgentInterventionReviewAuthorization;
  contractVersion: 2;
  /** Server-generated after context ACL; available even when the review is terminal. */
  conversationUrl?: string;
  review?: AgentInterventionReviewV2;
  status: AgentInterventionReviewStatus;
}

export type AgentInterventionResolutionAction =
  | {
      itemId: string;
      optionId: string;
      type: 'select_provider_option';
    }
  | {
      edits?: Record<string, Record<string, unknown>>;
      itemIds: string[];
      scope: 'once' | 'remember';
      type: 'approve_tool';
    }
  | {
      itemIds: string[];
      reason?: string;
      type: 'reject_continue';
    }
  | {
      scope: 'operation';
      type: 'stop';
    }
  | {
      itemId: string;
      result: Record<string, string | string[]>;
      type: 'submit_answers';
    }
  | {
      itemId: string;
      /** Validated fail-closed by the agent-marketplace server handler before claim. */
      result: { kind: 'agent_marketplace'; selectedTemplateIds: string[] };
      type: 'submit_custom';
    }
  | {
      itemId: string;
      type: 'skip_interaction';
    }
  | {
      itemId: string;
      type: 'cancel_interaction';
    };

export interface ResolveAgentInterventionParams {
  action: AgentInterventionResolutionAction;
  expectedBatchVersion: number;
  /** Must cover every member of the sealed batch, not only selected items. */
  expectedRequestRevisions: Record<string, AgentInterventionRequestRevision>;
  resolutionRequestId: string;
  reviewToken: string;
  userId: string;
  workspaceId?: string;
}

/**
 * Exact Web action semantics keyed by canonical runtime source locators.
 *
 * Web does not know durable intervention row ids or revisions. A Cloud
 * implementation resolves these locators to the complete sealed batch, checks
 * the conversation ACL, snapshots every row version/revision, then performs
 * the same atomic claim used by token-based Review. Operation/batch/message
 * ids are locators only and must never be treated as authorization.
 */
export type AgentInterventionSourceAction =
  | { optionId: string; type: 'select_provider_option' }
  | {
      /** Single-target only; Cloud maps the source message id to its durable item id. */
      edits?: Record<string, Record<string, unknown>>;
      scope: 'once' | 'remember';
      type: 'approve_tool';
    }
  | { reason?: string; type: 'reject_continue' }
  | { scope: 'operation'; type: 'stop' }
  | { result: Record<string, string | string[]>; type: 'submit_answers' }
  | {
      result: { kind: 'agent_marketplace'; selectedTemplateIds: string[] };
      type: 'submit_custom';
    }
  | { type: 'skip_interaction' }
  | { type: 'cancel_interaction' };

export interface AgentInterventionSourceTarget {
  toolCallId: string;
  toolMessageId: string;
}

export interface GetAgentInterventionReviewBySourceParams {
  actorUserId: string;
  batchId: string;
  operationId: string;
  targets: AgentInterventionSourceTarget[];
  workspaceId?: string;
}

/**
 * Source lookup distinguishes a deployment with no durable row from a found
 * review that is terminal, stale or view-only. `handled: false` is permitted
 * only when every source locator is absent; a partial/mismatched batch must
 * fail closed instead of falling back to unauthoritative client state.
 */
export type GetAgentInterventionReviewBySourceResult =
  | { handled: false }
  | (GetAgentInterventionReviewResult & {
      handled: true;
      /**
       * Read-only card-to-item mapping. It covers exactly the requested source
       * targets and is never accepted back as resolution authority.
       */
      sourceItemMap: Record<string, string>;
    });

export interface ResolveAgentInterventionBySourceParams {
  action: AgentInterventionSourceAction;
  actorUserId: string;
  batchId: string;
  operationId: string;
  resolutionRequestId: string;
  targets: AgentInterventionSourceTarget[];
  workspaceId?: string;
}

/**
 * Authoritative conversation location recovered from the durable operation.
 *
 * This deliberately mirrors the subset of `ExecAgentAppContext` required to
 * resume an existing message map. In particular, page and task runs must not
 * silently fall back to the main chat scope when a cold-start Review action is
 * dispatched. None of these values are accepted from the Review client.
 */
export interface AgentInterventionRuntimeAppContext {
  documentId?: string | null;
  groupId?: string | null;
  scope?: MessageMapScope;
  sessionId?: string;
  taskId?: string | null;
  threadId?: string | null;
  topicId: string;
}

export type AgentInterventionRuntimeAction =
  | {
      agentId: string;
      appContext: AgentInterventionRuntimeAppContext;
      batchId: string;
      handler: 'agent_marketplace';
      input: {
        action:
          | { selectedTemplateIds: string[]; type: 'submitted' }
          | { type: 'skipped' }
          | { type: 'cancelled' };
        categoryHints: string[];
        requestId: string;
      };
      operationId: string;
      parentMessageId: string;
      toolCallId: string;
      toolMessageIds: string[];
      type: 'execute_custom_interaction';
    }
  | {
      agentId: string;
      appContext: AgentInterventionRuntimeAppContext;
      decisions: Array<{
        decision: 'approved' | 'rejected_continue';
        parentMessageId: string;
        rejectionReason?: string;
        toolCallId: string;
      }>;
      /** Authoritative parked operation being continued; never client input. */
      operationId: string;
      parentMessageId: string;
      type: 'resume_approval';
    }
  | {
      agentId: string;
      appContext: AgentInterventionRuntimeAppContext;
      content: string;
      outcome: 'skipped' | 'submitted';
      /** Authoritative parked operation being continued; never client input. */
      operationId: string;
      parentMessageId: string;
      pluginState?: Record<string, unknown>;
      rejectionReason?: string;
      toolCallId: string;
      type: 'resume_tool_result';
    }
  | {
      batchId: string;
      operationId: string;
      terminalStatus: 'cancelled' | 'stopped';
      toolMessageIds: string[];
      topicId: string;
      type: 'stop';
    }
  | {
      operationId: string;
      response: {
        cancelReason?: 'user_cancelled';
        cancelled?: boolean;
        producerAck: false;
        resolutionRequestId: string;
        result?: unknown;
        toolCallId: string;
      };
      stepIndex?: number;
      type: 'heterogeneous_response';
    };

export type ResolveAgentInterventionResult =
  | { handled: false }
  | {
      contractVersion: 2;
      conversationUrl?: string;
      handled: true;
      /** Durable row owner; distinct from the resolving collaborator actor. */
      ownerUserId: string;
      state: 'already_resolved';
      status: Exclude<AgentInterventionReviewStatus, 'pending' | 'unavailable'>;
    }
  | {
      claimId: string;
      contractVersion: 2;
      conversationUrl?: string;
      handled: true;
      ownerUserId: string;
      resolutionRequestId: string;
      runtimeAction: AgentInterventionRuntimeAction;
      state: 'claimed';
      workspaceId?: string;
    };

/**
 * Source resolution preserves the durable claim outcome for Web callers.
 * `handled: false` is the OSS compatibility fallback and must not imply a
 * durable claim state.
 */
export type ResolveAgentInterventionBySourceResult =
  { handled: false; state?: never } | Extract<ResolveAgentInterventionResult, { handled: true }>;

export interface RollbackAgentInterventionResolutionParams {
  actorUserId: string;
  claimId: string;
  ownerUserId: string;
  resolutionRequestId: string;
  workspaceId?: string;
}

export interface AgentInterventionResolutionPublishedParams {
  actorUserId: string;
  claimId: string;
  ownerUserId: string;
  resolutionRequestId: string;
  /** Runtime actions complete here; heterogeneous actions stay resolving until producer ACK. */
  status: AgentInterventionReviewStatus;
  workspaceId?: string;
}

/**
 * Server-internal producer callback. The user id is the durable run owner, not
 * the actor that originally resolved the review. Cloud must still recover the
 * authoritative row/resolution before applying the transition.
 */
export interface AcknowledgeAgentInterventionProducerResolutionParams {
  operationId: string;
  ownerUserId: string;
  resolutionRequestId?: string;
  status: 'cancelled' | 'resolved' | 'session_ended' | 'timed_out';
  toolCallId: string;
  workspaceId?: string;
}

export interface NotifyAgentInterventionItem {
  allowedActions: AgentInterventionAllowedAction[];
  /** Server-derived only; never accepted from a resolution client. */
  canonicalToolKey?: string;
  /** Strictly notification-safe structured data; never raw runtime arguments. */
  detail?: Exclude<AgentInterventionReviewDetail, { type: 'tool_approval' }>;
  interactionKind: AgentInterventionReviewItem['interactionKind'];
  provider?: string;
  /**
   * Strictly bounded server execution context. It is persisted for cold-start
   * custom resolution but is not accepted back from, or necessarily exposed
   * to, a Review client.
   */
  request?: {
    categoryHints: string[];
    kind: 'agent_marketplace';
    requestId: string;
  };
  requestRevision: AgentInterventionRequestRevision;
  risk?: AgentInterventionRisk;
  /** Canonical server locator. Cloud must not copy raw arguments into the durable row. */
  sourceRef:
    | { toolCallId: string; toolMessageId: string; type: 'runtime' }
    | { operationId: string; toolCallId: string; type: 'heterogeneous' };
  summary: string;
  surface: AgentInterventionReviewItem['surface'];
}

export interface NotifyAgentInterventionRequiredParams {
  agentId?: string;
  /** Authoritative run snapshot; Cloud must not infer it from allowed actions. */
  approvalMode: 'allow-list' | 'auto-run' | 'headless' | 'manual';
  batch: {
    /** Stable opaque activity correlation, distinct from the producer batch id. */
    activityKey: string;
    allowedActions: AgentInterventionAllowedAction[];
    /** Stable producer/runtime id bound to this exact assistant turn. */
    id: string;
    kind: AgentInterventionReviewBatch['kind'];
    sealed: true;
    stepIndex: number;
  };
  context: Omit<AgentInterventionReviewContext, 'agent' | 'topic' | 'triggerRequest'>;
  deadline?: number;
  items: NotifyAgentInterventionItem[];
  summary: string;
  /**
   * A partial per-card decision may re-park the unresolved rows in a new
   * runtime operation. Cloud must terminal these exact old pending members and
   * create/observe the replacement batch in one durable transaction. The
   * winning old row may still be `resolving` because runtime scheduling races
   * the published hook; the transaction must converge that persisted claim to
   * its action-derived terminal outcome, and a late published hook is
   * idempotent. Only after this boundary may delivery end the old Activity and
   * fan out the new one.
   */
  supersedes?: {
    activityKey: string;
    batchId: string;
    operationId: string;
    toolCallIds: string[];
  };
  /**
   * A server-side eligibility assertion, not authorization. Cloud must still
   * have its signed direct-action capability explicitly enabled; every other
   * batch is Review-only.
   */
  systemActionEligibility: 'review_only' | 'safe_single_binary';
  userId: string;
  workspaceId?: string;
}

/** OSS has no durable intervention review store. Cloud overrides this module. */
export async function getAgentInterventionReview(
  _params: GetAgentInterventionReviewParams,
): Promise<GetAgentInterventionReviewResult> {
  return {
    authorization: { canResolve: false, canView: false },
    contractVersion: 2,
    status: 'unavailable',
  };
}

/**
 * Authenticated read-only lookup for an active chat card. Cloud resolves the
 * source locators, applies the conversation view ACL, and returns the same v2
 * review snapshot used by token Review. OSS has no durable generic store.
 */
export async function getAgentInterventionReviewBySource(
  _params: GetAgentInterventionReviewBySourceParams,
): Promise<GetAgentInterventionReviewBySourceResult> {
  return { handled: false };
}

/** Atomic, idempotent first-winner claim. OSS fails closed for token-based v2 resolution. */
export async function resolveAgentIntervention(
  _params: ResolveAgentInterventionParams,
): Promise<ResolveAgentInterventionResult> {
  return { handled: false };
}

/**
 * Authenticated Web bridge into the generic first-winner claim.
 *
 * Cloud resolves the source locators and builds the canonical item action.
 * For a mixed partially-settled Stop it supplies a full-batch version/revision
 * snapshot while selecting only rows that are still pending; terminal siblings
 * remain immutable. OSS has no durable generic store and falls back to its
 * existing in-request message-row claim.
 */
export async function resolveAgentInterventionBySource(
  _params: ResolveAgentInterventionBySourceParams,
): Promise<ResolveAgentInterventionBySourceResult> {
  return { handled: false };
}

/** Cloud conditionally releases only the still-owned claim after runtime dispatch fails. */
export async function rollbackAgentInterventionResolution(
  _params: RollbackAgentInterventionResolutionParams,
): Promise<void> {}

/** Runs only after the authoritative runtime dispatch succeeds. */
export async function onAgentInterventionResolutionPublished(
  _params: AgentInterventionResolutionPublishedParams,
): Promise<void> {}

/**
 * Completes a heterogeneous resolution only at the producer ACK boundary.
 * Cloud uses `resolutionRequestId` when present; legacy timeout/session-end
 * callbacks may recover the sealed batch through the operation/tool locator.
 */
export async function acknowledgeAgentInterventionProducerResolution(
  _params: AcknowledgeAgentInterventionProducerResolutionParams,
): Promise<void> {}

/**
 * Called only after the pending runtime state and all referenced tool messages
 * are durable. In a Cloud override, resolving this promise is the durable
 * Review-create boundary: the provider-neutral batch must already exist (or
 * have been idempotently observed). A rejection means persistence did not
 * succeed and is intentionally fatal/retryable to the parked lifecycle.
 *
 * Push / Live Activity fanout happens only after that create boundary and must
 * be caught, logged, or durably retried inside the Cloud implementation. A
 * downstream delivery failure must never reject this slot after persistence.
 * OSS deliberately has no durable store and therefore keeps the no-op default.
 */
export async function notifyAgentInterventionRequired(
  _params: NotifyAgentInterventionRequiredParams,
): Promise<void> {}

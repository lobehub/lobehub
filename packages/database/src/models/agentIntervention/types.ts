import type {
  AgentInterventionAllowedAction,
  AgentInterventionApprovalMode,
  AgentInterventionCustomExecutionResult,
  AgentInterventionExpectedRequestRevisionHashes,
  AgentInterventionExpectedVersions,
  AgentInterventionKind,
  AgentInterventionResolutionAction,
  AgentInterventionResolutionScope,
  AgentInterventionReviewContext,
  AgentInterventionRisk,
  AgentInterventionSanitizedRequest,
  AgentInterventionSource,
  AgentInterventionStatus,
  AgentInterventionSurface,
  AgentInterventionSystemActionEligibility,
} from '@lobechat/types';

import type {
  AgentInterventionItem,
  AgentInterventionResolutionItem,
  agentOperations,
} from '../../schemas';

export type AgentInterventionOperationIdentity = Pick<
  typeof agentOperations.$inferSelect,
  'agentId' | 'appContext' | 'chatGroupId' | 'id' | 'status' | 'taskId' | 'threadId' | 'topicId'
>;

export interface AgentInterventionLocator {
  activityKey: string;
  batchId: string;
  deadline: Date;
  id: string;
  operationId: string;
  source: AgentInterventionSource;
  status: AgentInterventionStatus;
  userId: string;
  workspaceId: null | string;
}

export interface AgentInterventionResolutionLocator {
  batchId: string;
  operationId: string;
  source: AgentInterventionSource;
  userId: string;
  workspaceId: null | string;
}

export interface ClaimAgentInterventionCustomExecutionParams {
  inputHash: string;
  leaseDurationMs: number;
  resolutionRequestId: string;
}

export type AgentInterventionCustomExecutionClaimResult =
  | {
      attempt: number;
      leaseExpiresAt: Date;
      leaseToken: string;
      outcome: 'applied';
    }
  | {
      attempt: number;
      leaseExpiresAt: Date;
      outcome: 'in_progress';
    }
  | {
      outcome: 'completed';
      result: AgentInterventionCustomExecutionResult;
    }
  | { outcome: 'conflict' };

export interface CompleteAgentInterventionCustomExecutionParams {
  inputHash: string;
  leaseToken: string;
  resolutionRequestId: string;
  result: AgentInterventionCustomExecutionResult;
}

export type AgentInterventionCustomExecutionCompletionResult =
  | {
      outcome: 'completed';
      result: AgentInterventionCustomExecutionResult;
    }
  | { outcome: 'conflict' };

export type AgentInterventionPrivateExecutionField =
  | 'customExecutionAttempt'
  | 'customExecutionInputHash'
  | 'customExecutionLeaseExpiresAt'
  | 'customExecutionLeaseToken'
  | 'customExecutionResult'
  | 'customExecutionState';

export type AgentInterventionResolutionPublicItem = Omit<
  AgentInterventionResolutionItem,
  AgentInterventionPrivateExecutionField
>;

export interface AgentInterventionBatchState {
  interventions: AgentInterventionItem[];
  resolutions: AgentInterventionResolutionPublicItem[];
}

export interface CreateAgentInterventionItemParams {
  allowedActions: readonly AgentInterventionAllowedAction[];
  canonicalToolKey?: string;
  interactionKind: AgentInterventionKind;
  provider?: string;
  requestRevisionHash: string;
  reviewContext: AgentInterventionReviewContext;
  reviewTokenHash: string;
  risk?: AgentInterventionRisk;
  sanitizedRequest: AgentInterventionSanitizedRequest;
  surface: AgentInterventionSurface;
  toolCallId: string;
  toolMessageId?: string;
}

export interface CreateAgentInterventionBatchParams {
  activityKey: string;
  approvalMode?: AgentInterventionApprovalMode;
  batchId: string;
  deadline: Date;
  items: CreateAgentInterventionItemParams[];
  operationId: string;
  provider?: string;
  source: AgentInterventionSource;
  stepIndex: number;
  systemActionEligibility: AgentInterventionSystemActionEligibility;
}

export interface AgentInterventionBatchSupersession {
  activityKey: string;
  batchId: string;
  operationId: string;
  toolCallIds: readonly string[];
}

export interface CreateAgentInterventionBatchWithSupersessionParams {
  batch: CreateAgentInterventionBatchParams;
  supersedes?: AgentInterventionBatchSupersession;
}

export interface AgentInterventionBatchSupersessionResult {
  interventions: AgentInterventionItem[];
  outcome: 'applied' | 'idempotent';
  superseded?: {
    activityKey: string;
    batchId: string;
    interventions: AgentInterventionItem[];
    operationId: string;
  };
}

export interface ClaimAgentInterventionBatchParams {
  action: AgentInterventionResolutionAction;
  actorId: string;
  batchId: string;
  expectedItemCount: number;
  expectedRequestRevisionHashes: AgentInterventionExpectedRequestRevisionHashes;
  expectedVersions: AgentInterventionExpectedVersions;
  operationId: string;
  resolutionRequestId: string;
  scope: AgentInterventionResolutionScope;
  selectedInterventionIds: string[];
}

export type AgentInterventionBatchMutationResult =
  | {
      interventions: AgentInterventionItem[];
      outcome: 'applied' | 'idempotent';
      resolution: AgentInterventionResolutionItem;
    }
  | {
      interventions?: AgentInterventionItem[];
      outcome: 'conflict' | 'not_found';
      resolution?: AgentInterventionResolutionItem;
    };

/**
 * Durable, owner-scoped state machine. Review-token lookup is deliberately a
 * separate system locator: callers must authorize view and resolve against the
 * resource before constructing this owner/workspace-scoped model.
 */

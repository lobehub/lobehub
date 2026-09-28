import type {
  AgentInterventionInteractionKind,
  AgentInterventionProvider,
  AgentInterventionResponseData,
} from '@lobechat/agent-gateway-client';

export type HeteroInterventionReviewStatus =
  | 'cancelled'
  | 'pending'
  | 'resolving'
  | 'resolved'
  | 'session_ended'
  | 'timed_out'
  | 'unavailable';

export interface HeteroInterventionReview {
  apiName: string;
  deadline: number;
  interactionKind: AgentInterventionInteractionKind;
  provider: AgentInterventionProvider;
  /**
   * Canonical, whitelisted AskUserQuestion JSON needed to render the review.
   * It may contain only questions and their display fields; permission/plan
   * options must retain exact provider ids. Never expose raw tool arguments.
   */
  renderArguments: string;
  /** Privacy-safe notification/review title. */
  summary: string;
}

export interface GetHeteroInterventionReviewParams {
  reviewToken: string;
  userId: string;
  workspaceId?: string;
}

export interface GetHeteroInterventionReviewResult {
  review?: HeteroInterventionReview;
  status: HeteroInterventionReviewStatus;
}

export type HeteroInterventionResolutionTarget =
  { operationId: string; toolCallId: string } | { reviewToken: string };

export interface ResolveHeteroInterventionParams {
  action: 'skip' | 'submit';
  cancelReason?: 'user_cancelled';
  /** Client-minted retry key; the same user intent must reuse the same UUID. */
  resolutionRequestId: string;
  result?: unknown;
  target: HeteroInterventionResolutionTarget;
  userId: string;
  workspaceId?: string;
}

export type ResolveHeteroInterventionResult =
  | { handled: false }
  | {
      handled: true;
      state: 'already_resolved';
      status: Exclude<HeteroInterventionReviewStatus, 'pending' | 'unavailable'>;
    }
  | {
      claimId: string;
      handled: true;
      operationId: string;
      /** Echoes the winning client retry key for conditional rollback. */
      resolutionRequestId: string;
      response: AgentInterventionResponseData;
      state: 'claimed';
      stepIndex?: number;
      /** Durable row scope resolved from the opaque token/direct target. */
      workspaceId?: string;
    };

export interface RollbackHeteroInterventionResolutionParams {
  claimId: string;
  operationId: string;
  resolutionRequestId: string;
  toolCallId: string;
  userId: string;
  workspaceId?: string;
}

export interface HeteroInterventionResolutionPublishedParams {
  claimId: string;
  operationId: string;
  resolutionRequestId: string;
  status: 'resolving';
  toolCallId: string;
  userId: string;
  workspaceId?: string;
}

/** OSS has no durable review-token store. Cloud overrides this module. */
export async function getHeteroInterventionReview(
  _params: GetHeteroInterventionReviewParams,
): Promise<GetHeteroInterventionReviewResult> {
  return { status: 'unavailable' };
}

/**
 * Atomic first-winner business slot. `handled: false` preserves the existing
 * OSS direct response-stream behavior; Cloud returns a durable claim.
 */
export async function resolveHeteroIntervention(
  _params: ResolveHeteroInterventionParams,
): Promise<ResolveHeteroInterventionResult> {
  return { handled: false };
}

/** Cloud conditionally releases only the still-owned claim after publish fails. */
export async function rollbackHeteroInterventionResolution(
  _params: RollbackHeteroInterventionResolutionParams,
): Promise<void> {}

/**
 * Runs only after the response-stream publish succeeds. Cloud may override
 * this to update notification surfaces to `resolving`; failure must never
 * release the already-published first-winner claim.
 */
export async function onHeteroInterventionResolutionPublished(
  _params: HeteroInterventionResolutionPublishedParams,
): Promise<void> {}

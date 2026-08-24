import type { HeteroInterventionReviewStatus } from '../agent-run/heteroInterventionReview';

export type ApnsEnvironment = 'production' | 'sandbox';

export interface RegisterLiveActivityPushToStartTokenParams {
  apnsEnvironment: ApnsEnvironment;
  deviceId: string;
  liveActivityPushToStartToken: string;
  userId: string;
  workspaceId?: string;
}

export interface RegisterAgentInterventionLiveActivityParams {
  /** Native ActivityKit id for diagnostics and token rotation. */
  activityId: string;
  /** Durable intervention identity, independent of ActivityKit's local id. */
  activityKey: string;
  apnsEnvironment: ApnsEnvironment;
  deviceId: string;
  operationId: string;
  pushToken: string;
  userId: string;
  workspaceId?: string;
}

export interface RegisterAgentInterventionLiveActivityResult {
  /** Current durable state so a late token registration can end immediately. */
  interventionStatus: HeteroInterventionReviewStatus;
}

/** OSS has no APNs ActivityKit token store. Cloud overrides this module. */
export async function registerLiveActivityPushToStartToken(
  _params: RegisterLiveActivityPushToStartTokenParams,
): Promise<void> {}

/** OSS reports unavailable; Cloud validates ownership and persists by activityKey. */
export async function registerAgentInterventionLiveActivity(
  _params: RegisterAgentInterventionLiveActivityParams,
): Promise<RegisterAgentInterventionLiveActivityResult> {
  return { interventionStatus: 'unavailable' };
}

import type {
  AgentInterventionInteractionKind,
  AgentInterventionProvider,
  AgentInterventionRequestData,
} from '@lobechat/agent-gateway-client';

export type AgentInterventionNotificationStatus =
  'cancelled' | 'pending' | 'resolved' | 'session_ended' | 'timed_out';

/**
 * Durable heterogeneous-intervention notification slot. Cloud overrides this
 * module; OSS deliberately performs no external side effect.
 */
export interface NotifyAgentInterventionParams {
  agentId?: string | null;
  deadline?: number;
  interactionKind: AgentInterventionInteractionKind;
  operationId: string;
  provider: AgentInterventionProvider | 'unknown';
  /**
   * Full producer request only on `pending`. Cloud must reconstruct a
   * canonical AskUserQuestion payload by whitelisting fields before storage,
   * and must never copy `arguments` directly into a push payload.
   */
  request?: AgentInterventionRequestData;
  /** Present on producer-ACK terminal transitions for claim correlation. */
  resolutionRequestId?: string;
  status: AgentInterventionNotificationStatus;
  /** Privacy-safe title; never contains raw tool arguments or answer values. */
  summary: string;
  toolCallId: string;
  topicId: string;
  userId: string;
  workspaceId?: string;
}

export async function notifyAgentIntervention(
  _params: NotifyAgentInterventionParams,
): Promise<void> {}

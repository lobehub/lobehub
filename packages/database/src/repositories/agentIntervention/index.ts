import type { AgentInterventionContext } from '../../models/agentIntervention/context';
import type {
  AgentInterventionBatchMutationResult,
  AgentInterventionBatchSupersessionResult,
  ClaimAgentInterventionBatchParams,
  CreateAgentInterventionBatchWithSupersessionParams,
} from '../../models/agentIntervention/types';
import type { LobeChatDatabase } from '../../type';
import * as claim from './claim';
import * as resolution from './resolution';
import * as supersession from './supersession';

/**
 * Agent intervention units of work that span more than the intervention
 * aggregate (`agent_interventions` + `agent_intervention_resolutions`):
 *
 * - superseding a batch retires the prior parked `agent_operations` row;
 * - claiming applies the decision's effects to the tool message
 *   (`message_plugins` / `messages.tools`) and the user's allow-list
 *   (`user_settings`), and rolling a claim back reverts them;
 * - completing a runtime resolution retires the parked operation.
 *
 * Each method commits in one transaction. Single-aggregate pieces stay in
 * `AgentInterventionModel` and its helper modules, which this repository composes.
 */
export class AgentInterventionRepository {
  private readonly ctx: AgentInterventionContext;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.ctx = { db, userId, workspaceId };
  }

  /**
   * Atomically replaces the still-pending remainder of a runtime batch after a
   * partial decision re-parks under a new operation. Without `supersedes`, this
   * creates the batch under the locked operation's status gate.
   */
  createBatchWithSupersession = (
    params: CreateAgentInterventionBatchWithSupersessionParams,
  ): Promise<AgentInterventionBatchSupersessionResult> =>
    supersession.createBatchWithSupersession(this.ctx, params);

  /**
   * Atomically validates a complete sealed Review snapshot and claims one,
   * selected, or all pending items, applying the decision's argument and
   * remember effects in the same transaction.
   */
  claimBatch = (
    params: ClaimAgentInterventionBatchParams,
  ): Promise<AgentInterventionBatchMutationResult> => claim.claimBatch(this.ctx, params);

  /** Publish failed before consumption; reopens this claim and reverts its effects. */
  rollbackResolution = (
    resolutionRequestId: string,
  ): Promise<AgentInterventionBatchMutationResult> =>
    resolution.rollbackResolution(this.ctx, resolutionRequestId);

  /** Runtime rows become terminal and the parked operation retires once the continuation starts. */
  completeRuntimeResolution = (
    resolutionRequestId: string,
    continuationStartedAt = new Date(),
  ): Promise<AgentInterventionBatchMutationResult> =>
    resolution.completeRuntimeResolution(this.ctx, resolutionRequestId, continuationStartedAt);

  /** Heterogeneous rows become terminal only after the matching producer ACK. */
  acknowledgeProducerResolution = (
    resolutionRequestId: string,
    producerAckAt = new Date(),
  ): Promise<AgentInterventionBatchMutationResult> =>
    resolution.acknowledgeProducerResolution(this.ctx, resolutionRequestId, producerAckAt);
}

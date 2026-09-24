import type { AgentState } from '../types';

/**
 * Read the run's policy and world facts from their typed slots.
 *
 * Each of these used to sit at the top level of the state; the slots say who
 * decided them and when (`principal.policy` is fixed per turn, `world` is what
 * the model is told). The legacy top-level copy is still accepted: a blob
 * written before the move is lifted by `normalizeAgentState` on load, but an
 * in-memory state a host assembles by hand may still carry the old shape, and a
 * missed intervention config would silently park a background run for approval.
 */
export const selectSecurityBlacklist = (
  state: Pick<AgentState, 'principal' | 'securityBlacklist'>,
): AgentState['securityBlacklist'] =>
  state.principal?.policy?.securityBlacklist ?? state.securityBlacklist;

export const selectUserInterventionConfig = (
  state: Pick<AgentState, 'principal' | 'userInterventionConfig'>,
): AgentState['userInterventionConfig'] =>
  state.principal?.policy?.userIntervention ?? state.userInterventionConfig;

export const selectExpertise = (
  state: Pick<AgentState, 'expertise' | 'world'>,
): AgentState['expertise'] => state.world?.expertise ?? state.expertise;

export const selectEnableExpertise = (
  state: Pick<AgentState, 'enableExpertise' | 'world'>,
): boolean | undefined => state.world?.enableExpertise ?? state.enableExpertise;

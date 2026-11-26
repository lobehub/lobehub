/**
 * What deleting an agent would take down besides the caller's own work, as the
 * delete confirmation shows it (`agent.getAgentDeleteImpact`).
 */
export interface AgentDeleteImpact {
  /** The agent was created by another member, not the caller. */
  createdByOther: boolean;
  /**
   * Display name of the agent's creator when it is someone other than the
   * caller (`null` when the caller created it, or the account has no name).
   */
  creatorName: string | null;
  /** Live topics other members started under the agent. */
  foreignTopicCount: number;
  /** Other members' topics, comments or messages go to the trash with it. */
  hasForeignContent: boolean;
}

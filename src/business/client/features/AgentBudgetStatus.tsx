export interface AgentBudgetStatusProps {
  agentId: string;
}

/**
 * Business slot above an agent's usage stats for a spend cap on that agent.
 *
 * The default renders nothing: a deployment without per-agent spend caps has
 * nothing to show. Deployments that cap spend per agent override the slot
 * with the agent's cap status.
 */
const AgentBudgetStatus = (_props: AgentBudgetStatusProps) => null;

export default AgentBudgetStatus;

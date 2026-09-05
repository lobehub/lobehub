export interface AgentShareSpendDetailProps {
  agentId: string;
}

/**
 * Business slot for the per-call spend table under the share stats tab.
 *
 * Open-source deployments do not meter share spend, so there is nothing to
 * list; Cloud overrides this with the creator's spend log filtered to visitor
 * runs of this agent.
 */
const AgentShareSpendDetail = (_props: AgentShareSpendDetailProps) => null;

export default AgentShareSpendDetail;

export interface AgentShareSpendDetailProps {
  agentId: string;
}

/**
 * Business slot for the per-call spend table under the share stats tab.
 *
 * The default renders nothing: a deployment that does not meter share spend
 * has nothing to list. Deployments that do override the slot with their own
 * per-call table.
 */
const AgentShareSpendDetail = (_props: AgentShareSpendDetailProps) => null;

export default AgentShareSpendDetail;

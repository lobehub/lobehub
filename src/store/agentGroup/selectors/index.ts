import { agentGroupByIdSelectors } from './byId';
import { currentSelectors } from './current';

export { agentGroupByIdSelectors } from './byId';

export const agentGroupSelectors = {
  ...currentSelectors,
  getAgentByIdFromGroup: agentGroupByIdSelectors.agentByIdFromGroup,
  getGroupAgentCount: agentGroupByIdSelectors.groupAgentCount,
  getGroupAgents: agentGroupByIdSelectors.groupAgents,
  getGroupById: agentGroupByIdSelectors.groupById,
  getGroupBySupervisorAgentId: agentGroupByIdSelectors.groupBySupervisorAgentId,
  getGroupConfig: agentGroupByIdSelectors.groupConfig,
  getGroupMemberCount: agentGroupByIdSelectors.groupMemberCount,
  getGroupMembers: agentGroupByIdSelectors.groupMembers,
  getGroupMeta: agentGroupByIdSelectors.groupMeta,
};

import { type AvailableAgentItem } from '@/services/agent';

/**
 * Agents the user may pick as new group members.
 *
 * `queryAgents` includes the inbox (Lobe AI) so general lookups can reach it,
 * but `ChatGroupModel.addAgentsToGroup` refuses builtins with `BAD_REQUEST`.
 * Offering it here would turn a selection into a failed add, so the picker
 * applies the same rule before the user can choose it.
 */
export const selectAddableAgents = <T extends Pick<AvailableAgentItem, 'id' | 'isInbox'>>(
  agents: T[],
  existingMemberIds: string[],
): T[] => agents.filter((agent) => !agent.isInbox && !existingMemberIds.includes(agent.id));

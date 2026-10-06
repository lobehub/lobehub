import { type AvailableAgentItem } from '@/services/agent';

/**
 * Agents the user may pick as new group members.
 *
 * `queryAgents` leaves the inbox (Lobe AI) out unless the caller opts in, and
 * this picker does not. The `isInbox` check is a guard for that contract:
 * `ChatGroupModel.addAgentsToGroup` refuses builtins with `BAD_REQUEST`, so an
 * inbox that ever reached this list would turn a selection into a failed add.
 */
export const selectAddableAgents = <T extends Pick<AvailableAgentItem, 'id' | 'isInbox'>>(
  agents: T[],
  existingMemberIds: string[],
): T[] => agents.filter((agent) => !agent.isInbox && !existingMemberIds.includes(agent.id));

import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import type { SidebarAgentItem } from '@lobechat/types';

import { type AvailableAgentItem } from '@/services/agent';

const builtinAgentSlugs = new Set<string>(Object.values(BUILTIN_AGENT_SLUGS));

/**
 * The picker's candidates from the sidebar agent list: agents only (no chat
 * groups, no builtins), most recently updated first like `queryAgents`.
 */
export const toPickableAgents = (items: SidebarAgentItem[]): AvailableAgentItem[] => {
  const seen = new Set<string>();

  return items
    .filter((item) => {
      if (item.type !== 'agent' || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map((item) => ({
      avatar: typeof item.avatar === 'string' ? item.avatar : null,
      backgroundColor: item.backgroundColor ?? null,
      description: item.description ?? null,
      id: item.id,
      isInbox: !!item.slug && builtinAgentSlugs.has(item.slug),
      name: item.name ?? null,
      title: item.title,
    }));
};

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

import { agentDisplayName, type SidebarAgentItem, type SidebarGroup } from '@lobechat/types';

export interface MoveTargetSources {
  agentGroups: SidebarGroup[];
  /** Virtual inbox agent, prepended to the workspace bucket when missing. */
  inbox?: SidebarAgentItem;
  pinnedAgents: SidebarAgentItem[];
  privateAgentGroups: SidebarGroup[];
  privatePinnedAgents: SidebarAgentItem[];
  privateUngroupedAgents: SidebarAgentItem[];
  search?: string;
  /** Source agent — excluded so a no-op move can't be chosen. */
  sourceAgentId?: string | null;
  ungroupedAgents: SidebarAgentItem[];
}

export interface MoveTargets {
  privateAgents: SidebarAgentItem[];
  workspaceAgents: SidebarAgentItem[];
}

/**
 * Split move targets into the user's private agents and the shared/workspace
 * agents, so private agents don't get buried at the end of a long list.
 * In personal mode the private buckets are empty and everything is "workspace".
 */
export const buildMoveTargets = ({
  agentGroups,
  inbox,
  pinnedAgents,
  privateAgentGroups,
  privatePinnedAgents,
  privateUngroupedAgents,
  search,
  sourceAgentId,
  ungroupedAgents,
}: MoveTargetSources): MoveTargets => {
  const q = search?.trim().toLowerCase();
  const pick = (list: SidebarAgentItem[]) =>
    list.filter(
      (a) =>
        a.type === 'agent' &&
        a.id !== sourceAgentId &&
        (!q || (agentDisplayName(a) ?? '').toLowerCase().includes(q)),
    );

  const privateAgents = pick([
    ...privatePinnedAgents,
    ...privateAgentGroups.flatMap((g) => g.items),
    ...privateUngroupedAgents,
  ]);

  const shared = [...pinnedAgents, ...agentGroups.flatMap((g) => g.items), ...ungroupedAgents];
  const withInbox =
    inbox && ![...shared, ...privateAgents].some((a) => a.id === inbox.id)
      ? [inbox, ...shared]
      : shared;

  return { privateAgents, workspaceAgents: pick(withInbox) };
};

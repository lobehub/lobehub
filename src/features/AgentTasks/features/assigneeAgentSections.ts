import { agentDisplayName } from '@lobechat/types';

import { type SidebarAgentItem, type SidebarGroup } from '@/database/repositories/home';

/** How many recently assigned agents the picker offers above the full list. */
export const MAX_RECENT_ASSIGNEES = 5;

export interface AssigneeAgentSection {
  agents: SidebarAgentItem[];
  /** Only the user's own sidebar groups fold; pinned and the rest stay open. */
  collapsible: boolean;
  id: string;
  /** Omitted when the section is the only one, so a flat list keeps no header. */
  title?: string;
}

interface BuildSectionsParams {
  groups: SidebarGroup[];
  labels: { pinned: string; ungrouped: string };
  pinned: SidebarAgentItem[];
  /** Keeps private and workspace section ids apart. */
  scope: string;
  ungrouped: SidebarAgentItem[];
}

const onlyAgents = (items: SidebarAgentItem[]) => items.filter((item) => item.type === 'agent');

/**
 * Mirror the sidebar's layout (pinned, then the user's groups in sidebar order,
 * then everything else), so the grouping a user keeps in the sidebar also
 * organizes the assignee picker.
 */
export const buildAssigneeAgentSections = ({
  groups,
  labels,
  pinned,
  scope,
  ungrouped,
}: BuildSectionsParams): AssigneeAgentSection[] => {
  const sections: AssigneeAgentSection[] = [];

  const pinnedAgents = onlyAgents(pinned);
  if (pinnedAgents.length > 0)
    sections.push({
      agents: pinnedAgents,
      collapsible: false,
      id: `${scope}:pinned`,
      title: labels.pinned,
    });

  for (const group of groups) {
    const agents = onlyAgents(group.items);
    if (agents.length === 0) continue;
    sections.push({ agents, collapsible: true, id: group.id, title: group.name });
  }

  const ungroupedAgents = onlyAgents(ungrouped);
  if (ungroupedAgents.length > 0)
    sections.push({
      agents: ungroupedAgents,
      collapsible: false,
      id: `${scope}:ungrouped`,
      title: sections.length > 0 ? labels.ungrouped : undefined,
    });

  return sections;
};

export const matchesAssigneeSearch = (agent: SidebarAgentItem, query: string) =>
  [agentDisplayName(agent), agent.title, agent.description].some((label) =>
    (label ?? '').toLowerCase().includes(query),
  );

export const filterAssigneeSections = (
  sections: AssigneeAgentSection[],
  query: string,
): AssigneeAgentSection[] => {
  if (!query) return sections;
  return sections
    .map((section) => ({
      ...section,
      agents: section.agents.filter((agent) => matchesAssigneeSearch(agent, query)),
    }))
    .filter((section) => section.agents.length > 0);
};

/** Resolve stored ids against the agents the picker can offer, newest first. */
export const pickRecentAssignees = (
  recentIds: string[] | undefined,
  available: SidebarAgentItem[],
): SidebarAgentItem[] => {
  if (!recentIds?.length) return [];
  const byId = new Map(available.map((agent) => [agent.id, agent]));
  return recentIds
    .map((id) => byId.get(id))
    .filter((agent): agent is SidebarAgentItem => !!agent)
    .slice(0, MAX_RECENT_ASSIGNEES);
};

/**
 * Move `agentId` to the front. The list never gets shorter: `updateSystemStatus`
 * merges arrays by index, so a shorter write would keep the old tail.
 */
export const pushRecentAssignee = (current: string[] | undefined, agentId: string): string[] =>
  [agentId, ...(current ?? []).filter((id) => id !== agentId)].slice(0, MAX_RECENT_ASSIGNEES);

/**
 * A public task only takes a private agent once it is private itself, and only
 * its creator may make a workspace task private, so the creator alone is
 * offered private agents there (behind a confirmation). A caller that owns the
 * change through `onChange` (e.g. a create form) keeps the plain public list.
 */
export const shouldOfferPrivateAgents = ({
  currentUserId,
  hasOnChange,
  taskCreatorId,
  taskIdentifier,
  taskVisibility,
  workspaceId,
}: {
  currentUserId?: string | null;
  hasOnChange: boolean;
  taskCreatorId?: string | null;
  taskIdentifier?: string;
  taskVisibility?: 'private' | 'public' | null;
  workspaceId?: string | null;
}): { offer: boolean; privatizes: boolean } => {
  if (taskVisibility !== 'public') return { offer: true, privatizes: false };
  const privatizes =
    !hasOnChange &&
    !!taskIdentifier &&
    !!workspaceId &&
    !!currentUserId &&
    taskCreatorId === currentUserId;
  return { offer: privatizes, privatizes };
};

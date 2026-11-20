import { INBOX_SESSION_ID, isHeterogeneousAgentModelId } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';

import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { projectAgentIds, projectMemberAgentIds } from './projectAgentOrder';

export interface ChannelAgentOption extends SidebarAgentItem {
  /** External runtime label source; `undefined` for a Native Agent. */
  runtime?: string;
}

/** Same rule as `ChannelService.resolveAgent`: anything but Native needs a device. */
const agentRuntime = (agent: SidebarAgentItem) =>
  agent.heterogeneousType ||
  (isHeterogeneousAgentModelId(agent.model) ? agent.model : undefined) ||
  undefined;

/**
 * The project's own Agents: ranked for the picker, all of its members, and whether the caller may
 * add another one. The project sidebar has usually loaded the detail under its route slug
 * already, so reuse it by id before fetching.
 */
const useProjectAgents = (projectId?: string) => {
  const detail = useProjectStore((s) =>
    projectId
      ? Object.values(s.projectDetailMap).find((item) => item?.project.id === projectId)
      : undefined,
  );
  useProjectStore((s) => s.useFetchProjectDetail)(projectId && !detail ? projectId : undefined);
  return {
    canAddToProject: detail?.permissions?.canManageMembers ?? false,
    memberIds: projectMemberAgentIds(detail),
    priorityIds: projectAgentIds(detail),
    projectName: detail?.project.name,
  };
};

/**
 * Every Agent the user can add, from the full sidebar list rather than the recent
 * delegation targets, so older Agents stay reachable. Lobe AI cannot join a Channel.
 * Inside a project, `projectAgentIds` names the project's Agents to list first, and `project`
 * says which Agents are already its members: a project Channel seats only those, so picking
 * anyone else adds them to the project too.
 */
export const useChannelAgentOptions = (projectId?: string) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const sync = useHomeStore((s) => s.useFetchAgentList)(isLogin);
  const ready = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const items = useHomeStore(homeAgentListSelectors.allAgents);
  const project = useProjectAgents(projectId);
  const agents: ChannelAgentOption[] | undefined = ready
    ? items
        .filter((item) => item.type === 'agent' && item.slug !== INBOX_SESSION_ID)
        .map((item) => ({ ...item, runtime: agentRuntime(item) }))
    : undefined;
  return {
    agents,
    error: sync.error,
    project: projectId
      ? {
          canAddAgents: project.canAddToProject,
          memberIds: project.memberIds,
          name: project.projectName,
        }
      : undefined,
    projectAgentIds: project.priorityIds,
    retry: () => void sync.revalidate(),
  };
};

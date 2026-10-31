import { INBOX_SESSION_ID, isHeterogeneousAgentModelId } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';

import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useProjectStore } from '@/store/project';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { projectAgentIds } from './projectAgentOrder';

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
 * The project's own Agents, ranked for the picker. The project sidebar has usually loaded the
 * detail under its route slug already, so reuse it by id before fetching.
 */
const useProjectAgentIds = (projectId?: string) => {
  const detail = useProjectStore((s) =>
    projectId
      ? Object.values(s.projectDetailMap).find((item) => item?.project.id === projectId)
      : undefined,
  );
  useProjectStore((s) => s.useFetchProjectDetail)(projectId && !detail ? projectId : undefined);
  return projectAgentIds(detail);
};

/**
 * Every Agent the user can add, from the full sidebar list rather than the recent
 * delegation targets, so older Agents stay reachable. Lobe AI cannot join a Channel.
 * Inside a project, `projectAgentIds` names the project's Agents to list first.
 */
export const useChannelAgentOptions = (projectId?: string) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const sync = useHomeStore((s) => s.useFetchAgentList)(isLogin);
  const ready = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const items = useHomeStore(homeAgentListSelectors.allAgents);
  const priorityIds = useProjectAgentIds(projectId);
  const agents: ChannelAgentOption[] | undefined = ready
    ? items
        .filter((item) => item.type === 'agent' && item.slug !== INBOX_SESSION_ID)
        .map((item) => ({ ...item, runtime: agentRuntime(item) }))
    : undefined;
  return {
    agents,
    error: sync.error,
    projectAgentIds: priorityIds,
    retry: () => void sync.revalidate(),
  };
};

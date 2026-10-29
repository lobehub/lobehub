import { INBOX_SESSION_ID, isHeterogeneousAgentModelId } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';

import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors } from '@/store/home/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

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
 * Every Agent the user can add, from the full sidebar list rather than the recent
 * delegation targets, so older Agents stay reachable. Lobe AI cannot join a Channel.
 */
export const useChannelAgentOptions = () => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const sync = useHomeStore((s) => s.useFetchAgentList)(isLogin);
  const ready = useHomeStore(homeAgentListSelectors.isAgentListInit);
  const items = useHomeStore(homeAgentListSelectors.allAgents);
  const agents: ChannelAgentOption[] | undefined = ready
    ? items
        .filter((item) => item.type === 'agent' && item.slug !== INBOX_SESSION_ID)
        .map((item) => ({ ...item, runtime: agentRuntime(item) }))
    : undefined;
  return { agents, error: sync.error, retry: () => void sync.revalidate() };
};

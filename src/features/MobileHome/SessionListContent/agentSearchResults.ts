import type { SidebarAgentItem } from '@lobechat/types';

export const getVisibleAgentSearchResults = (
  results: SidebarAgentItem[] | undefined,
  isMobile: boolean,
): SidebarAgentItem[] | undefined => {
  if (!results || !isMobile) return results;

  return results.filter((item) => item.type === 'agent');
};

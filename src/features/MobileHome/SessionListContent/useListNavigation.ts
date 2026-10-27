import { agentDisplayName, type SidebarAgentItem } from '@lobechat/types';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { trackProductUsageEvent } from '@/libs/analytics/productUsageEvent';
import { useChatStore } from '@/store/chat';
import { useHomeStore } from '@/store/home';
import { getUserStoreState } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

export const useListNavigation = (source: 'list' | 'search') => {
  const { t } = useTranslation('chat');

  return (
    event: MouseEvent<HTMLAnchorElement>,
    item: SidebarAgentItem,
    groupId?: string | null,
  ) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (event.currentTarget.target && event.currentTarget.target !== '_self')
    )
      return;

    useChatStore.getState().clearPortalStack();

    const home = useHomeStore.getState();
    const groups = [...home.agentGroups, ...home.privateAgentGroups];
    const pinnedItem = [...home.pinnedAgents, ...home.privatePinnedAgents].find(
      (child) => child.id === item.id && child.type === item.type,
    );
    const categoryId = groupId === undefined ? (item.groupId ?? pinnedItem?.groupId) : groupId;
    const group = groups.find((group) =>
      categoryId
        ? group.id === categoryId
        : group.items.some((child) => child.id === item.id && child.type === item.type),
    );
    const isUngrouped =
      categoryId === null ||
      [...home.ungroupedAgents, ...home.privateUngroupedAgents].some(
        (child) => child.id === item.id && child.type === item.type,
      );

    void trackProductUsageEvent({
      name: 'switch_session',
      properties: {
        agent_id: item.type === 'agent' ? item.id : undefined,
        assistant_name: agentDisplayName(
          item,
          t(item.type === 'group' ? 'untitledGroup' : 'untitledAgent'),
        ),
        chat_group_id: item.type === 'group' ? item.id : undefined,
        group_id: group?.id ?? (isUngrouped ? 'default' : undefined),
        group_name: group?.name ?? (isUngrouped ? 'Default' : undefined),
        resource_id: item.id,
        resource_type: item.type,
        spm:
          source === 'list'
            ? 'homepage.chat.session_list_item.click'
            : 'homepage.chat.search_result.click',
        user_id: userProfileSelectors.userId(getUserStoreState()) || 'anonymous',
      },
    });
  };
};

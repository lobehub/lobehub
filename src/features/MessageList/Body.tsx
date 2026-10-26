'use client';

import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors, homeRecentSelectors } from '@/store/home/selectors';
import { ALL_RECENTS_LIMIT } from '@/store/home/slices/recent/action';
import { createRecentQueryKey } from '@/store/home/slices/recent/projection';

import AgentConversation from './AgentConversation';
import { buildConversationSections, type Conversation } from './conversations';
import GroupConversation from './GroupConversation';
import InboxConversation from './InboxConversation';
import { styles } from './style';

const RECENTS_QUERY_KEY = createRecentQueryKey(ALL_RECENTS_LIMIT);

/** `/agent/:id/...` or `/group/:id/...` → the routed conversation id. */
const useActiveRouteId = () => {
  const { pathname } = useActiveLocation();
  const slug = useActiveWorkspaceSlug();
  const segments = pathname.split('/').filter(Boolean);
  const [root, id] = slug && segments[0] === slug ? segments.slice(1) : segments;

  return root === 'agent' || root === 'group' ? id : undefined;
};

const ConversationItem = memo<{ activeRouteId?: string; conversation: Conversation }>(
  ({ activeRouteId, conversation }) => {
    const active = conversation.item.id === activeRouteId;

    return conversation.item.type === 'group' ? (
      <GroupConversation active={active} conversation={conversation} />
    ) : (
      <AgentConversation active={active} conversation={conversation} />
    );
  },
);

ConversationItem.displayName = 'ConversationItem';

const Body = memo(() => {
  const { t } = useTranslation('common');
  useFetchAgentList();
  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  useHomeStore((s) => s.useFetchAllRecents)(true);

  const items = useHomeStore(homeAgentListSelectors.allAgents, isEqual);
  const recents = useHomeStore(homeRecentSelectors.query(RECENTS_QUERY_KEY));
  const activeRouteId = useActiveRouteId();

  const { pinned, recent } = useMemo(
    () => buildConversationSections(items, recents),
    [items, recents],
  );

  if (!isInit && items.length === 0) return <SkeletonList paddingBlock={8} />;

  return (
    <Flexbox gap={1} paddingBlock={'0 12px'} paddingInline={6}>
      <InboxConversation activeRouteId={activeRouteId} />
      {pinned.length > 0 && (
        <>
          <div {...stylex.props(styles.sectionTitle)}>{t('navPanel.pinned')}</div>
          {pinned.map((conversation) => (
            <ConversationItem
              activeRouteId={activeRouteId}
              conversation={conversation}
              key={conversation.item.id}
            />
          ))}
        </>
      )}
      <div {...stylex.props(styles.sectionTitle)}>{t('navPanel.switcherRecent')}</div>
      {recent.length === 0 ? (
        <div {...stylex.props(styles.empty)}>{t('messageList.empty')}</div>
      ) : (
        recent.map((conversation) => (
          <ConversationItem
            activeRouteId={activeRouteId}
            conversation={conversation}
            key={conversation.item.id}
          />
        ))
      )}
    </Flexbox>
  );
});

Body.displayName = 'MessageListBody';

export default Body;

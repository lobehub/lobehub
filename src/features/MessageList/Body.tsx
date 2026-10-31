'use client';

import { agentDisplayName } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import { resolveInboxAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import ChannelList from '@/features/Channels/ChannelList';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors, homeRecentSelectors } from '@/store/home/selectors';
import { ALL_RECENTS_LIMIT } from '@/store/home/slices/recent/action';
import { createRecentQueryKey } from '@/store/home/slices/recent/projection';

import AgentConversation from './AgentConversation';
import {
  buildConversationEntries,
  buildConversationSections,
  type Conversation,
} from './conversations';
import GroupConversation from './GroupConversation';
import InboxConversation from './InboxConversation';
import { useMessageSearch } from './SearchContext';
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

  const { query } = useMessageSearch();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxUpdatedAt = useAgentStore((s) =>
    inboxAgentId ? s.agentMap[inboxAgentId]?.updatedAt : undefined,
  );
  const inboxTitle = useAgentStore((s) =>
    agentDisplayName(
      agentSelectors.getAgentMetaById(resolveInboxAgentRouteId(inboxAgentId))(s),
      'Lobe AI',
    ),
  );

  const entries = useMemo(
    () =>
      buildConversationEntries(
        buildConversationSections(items, recents),
        { activeAt: inboxUpdatedAt ? new Date(inboxUpdatedAt) : undefined, title: inboxTitle },
        query,
      ),
    [items, recents, inboxUpdatedAt, inboxTitle, query],
  );

  // Only the agent rows wait on the agent list: Lobe AI and Channels load on
  // their own, so a slow or failed agent-list request must not hide them.
  const agentsLoading = !isInit && items.length === 0;

  return (
    <Flexbox gap={1} paddingBlock={'0 12px'} paddingInline={6}>
      {entries.map((entry) =>
        entry.type === 'inbox' ? (
          <InboxConversation activeRouteId={activeRouteId} key={'inbox'} />
        ) : (
          <ConversationItem
            activeRouteId={activeRouteId}
            conversation={entry}
            key={entry.item.id}
          />
        ),
      )}
      {agentsLoading ? (
        <SkeletonList paddingBlock={8} />
      ) : (
        entries.length === 0 && (
          <div {...stylex.props(styles.empty)}>
            {query ? t('navPanel.searchResultEmpty') : t('messageList.empty')}
          </div>
        )
      )}
      {/* Non-project Channels (and their create entry) have no other home in the rail layout. */}
      <ChannelList />
    </Flexbox>
  );
});

Body.displayName = 'MessageListBody';

export default Body;

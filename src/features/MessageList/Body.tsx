'use client';

import { DEFAULT_INBOX_TITLE } from '@lobechat/const';
import { agentDisplayName } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import isEqual from 'fast-deep-equal';
import { Archive } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceSlug } from '@/business/client/hooks/useActiveWorkspaceSlug';
import AsyncError from '@/components/AsyncError';
import { resolveInboxAgentRouteId } from '@/features/AgentRoute/useResolvedAgentRouteId';
import { matchChannel } from '@/features/Channels/paths';
import { useChannelEvents } from '@/features/Channels/useChannelEvents';
import { useChannelsEnabled } from '@/features/Channels/useChannelsEnabled';
import NavItem from '@/features/NavPanel/components/NavItem';
import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useActiveLocation } from '@/hooks/useActiveLocation';
import { useFetchAgentList } from '@/hooks/useFetchAgentList';
import { useAgentStore } from '@/store/agent';
import { agentSelectors, builtinAgentSelectors } from '@/store/agent/selectors';
import { channelActions, channelSelectors, useChannelStore } from '@/store/channel';
import { useHomeStore } from '@/store/home';
import { homeAgentListSelectors, homeRecentSelectors } from '@/store/home/selectors';
import { ALL_RECENTS_LIMIT } from '@/store/home/slices/recent/action';
import { createConversationRecentQueryKey } from '@/store/home/slices/recent/projection';

import AgentConversation from './AgentConversation';
import ChannelConversation from './ChannelConversation';
import {
  buildConversationEntries,
  buildConversationSections,
  channelActivity,
  type Conversation,
  type ConversationEntry,
  inboxActivity,
  latestTopicOf,
} from './conversations';
import GroupConversation from './GroupConversation';
import InboxConversation from './InboxConversation';
import { useMessageSearch } from './SearchContext';
import { styles } from './style';

const RECENTS_QUERY_KEY = createConversationRecentQueryKey(ALL_RECENTS_LIMIT);

/**
 * `/agent/:id/...`, `/group/:id/...` or `/channels/:id` → the routed conversation id. A direct
 * Channel stands for its Agent, so opening one highlights that Agent's row.
 */
const useActiveRouteId = () => {
  const { pathname } = useActiveLocation();
  const slug = useActiveWorkspaceSlug();
  const channelId = matchChannel(pathname);
  const directAgentId = useChannelStore((s) =>
    channelId
      ? channelSelectors.list(s)?.find((channel) => channel.id === channelId)?.agentId
      : undefined,
  );
  if (channelId) return directAgentId ?? channelId;

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

/** Keeps the Channel list fresh while Channels are on; it has no row of its own. */
const ChannelSync = memo(() => {
  const { error } = channelActions.useFetchList();
  useChannelEvents();

  return error ? (
    <AsyncError error={error} variant="inline" onRetry={() => void channelActions.refreshList()} />
  ) : null;
});

ChannelSync.displayName = 'MessageListChannelSync';

const Body = memo(() => {
  const { t } = useTranslation(['common', 'channel']);
  const { error: agentsError, mutate: retryAgents } = useFetchAgentList();
  const isInit = useHomeStore(homeAgentListSelectors.isAgentListInit);
  useHomeStore((s) => s.useFetchConversationRecents)(ALL_RECENTS_LIMIT);

  const items = useHomeStore(homeAgentListSelectors.allAgents, isEqual);
  const recents = useHomeStore(homeRecentSelectors.conversationRecents(RECENTS_QUERY_KEY));
  const activeRouteId = useActiveRouteId();
  const channelsEnabled = useChannelsEnabled();
  const allChannels = useChannelStore(channelSelectors.list);
  const { query } = useMessageSearch();
  const [showArchived, setShowArchived] = useState(false);
  // Group Channels outside any project; a direct Channel opens from its Agent's row. An archived
  // one leaves the list unless it is open, but search still finds it and the archived group at
  // the end lists it.
  const directChannels = useMemo(
    () =>
      new Map(
        channelsEnabled
          ? (allChannels ?? [])
              .filter((channel) => channel.agentId && !channel.projectId)
              .map((channel) => [channel.agentId!, channel] as const)
          : [],
      ),
    [allChannels, channelsEnabled],
  );
  const { archived, channels } = useMemo(() => {
    const groups = channelsEnabled
      ? (allChannels ?? []).filter((channel) => !channel.projectId && !channel.agentId)
      : [];
    const isHidden = (channel: (typeof groups)[number]) =>
      channel.status === 'archived' && channel.id !== activeRouteId;
    return {
      archived: groups
        .filter(isHidden)
        .sort((a, b) => channelActivity(b).getTime() - channelActivity(a).getTime()),
      channels: query.trim() ? groups : groups.filter((channel) => !isHidden(channel)),
    };
  }, [activeRouteId, allChannels, channelsEnabled, query]);

  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const inboxUpdatedAt = useAgentStore((s) =>
    inboxAgentId ? s.agentMap[inboxAgentId]?.updatedAt : undefined,
  );
  const inboxTitle = useAgentStore((s) =>
    agentDisplayName(
      agentSelectors.getAgentMetaById(resolveInboxAgentRouteId(inboxAgentId))(s),
      DEFAULT_INBOX_TITLE,
    ),
  );

  // The inbox is not one of the sidebar rows, so its position comes from its
  // own latest topic rather than from the agent's configuration timestamp.
  const inboxTopic = useMemo(
    () => latestTopicOf(recents, inboxAgentId ?? undefined),
    [recents, inboxAgentId],
  );

  const inboxChannel = inboxAgentId ? directChannels.get(inboxAgentId) : undefined;

  const entries = useMemo(
    () =>
      buildConversationEntries(
        buildConversationSections(items, recents, directChannels),
        {
          activeAt: inboxActivity(inboxUpdatedAt, inboxTopic, inboxChannel),
          channel: inboxChannel,
          title: inboxTitle,
        },
        query,
        channels,
      ),
    [
      items,
      recents,
      directChannels,
      inboxUpdatedAt,
      inboxTitle,
      inboxTopic,
      inboxChannel,
      query,
      channels,
    ],
  );

  // Pinned rows lead the list; they render as one block rather than a card each.
  const pinnedCount = entries.findIndex((entry) => entry.type !== 'item' || !entry.item.pinned);
  const pinnedEntries = pinnedCount === -1 ? entries : entries.slice(0, pinnedCount);
  const otherEntries = pinnedCount === -1 ? [] : entries.slice(pinnedCount);

  const renderEntry = (entry: ConversationEntry) =>
    entry.type === 'inbox' ? (
      <InboxConversation
        activeAt={entry.activeAt}
        activeRouteId={activeRouteId}
        channel={entry.channel}
        key={'inbox'}
      />
    ) : entry.type === 'channel' ? (
      <ChannelConversation
        active={entry.channel.id === activeRouteId}
        activeAt={entry.activeAt}
        channel={entry.channel}
        key={entry.channel.id}
      />
    ) : (
      <ConversationItem activeRouteId={activeRouteId} conversation={entry} key={entry.item.id} />
    );

  // Only the agent rows wait on the agent list: Lobe AI and Channels load on
  // their own, so a slow or failed agent-list request must not hide them.
  const agentsLoading = !isInit && items.length === 0;

  return (
    <Flexbox gap={1} paddingBlock={'0 12px'} paddingInline={6}>
      {pinnedEntries.length > 0 && (
        <div aria-label={t('navPanel.pinned')} role="group" {...stylex.props(styles.pinnedGroup)}>
          {pinnedEntries.map(renderEntry)}
        </div>
      )}
      {otherEntries.map(renderEntry)}
      {agentsLoading ? (
        agentsError ? (
          <AsyncError error={agentsError} variant="inline" onRetry={() => void retryAgents()} />
        ) : (
          <SkeletonList paddingBlock={8} />
        )
      ) : (
        entries.length === 0 && (
          <div {...stylex.props(styles.empty)}>
            {query ? t('navPanel.searchResultEmpty') : t('messageList.empty')}
          </div>
        )
      )}
      {!query.trim() && archived.length > 0 && (
        <>
          <NavItem
            aria-expanded={showArchived}
            icon={Archive}
            title={t('archivedGroup', { count: archived.length, ns: 'channel' })}
            onClick={() => setShowArchived(!showArchived)}
          />
          {showArchived &&
            archived.map((channel) => (
              <ChannelConversation
                active={false}
                activeAt={channelActivity(channel)}
                channel={channel}
                key={channel.id}
              />
            ))}
        </>
      )}
      {channelsEnabled && <ChannelSync />}
    </Flexbox>
  );
});

Body.displayName = 'MessageListBody';

export default Body;

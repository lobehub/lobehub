import type { ChannelListItem, RecentItem, SidebarAgentItem } from '@lobechat/types';

import { markdownToTxt } from '@/utils/markdownToTxt';

/** A plain left click; modified clicks keep the browser's own handling of the link. */
export const isPlainClick = (
  event: Pick<MouseEvent, 'altKey' | 'button' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export interface Conversation {
  /** Latest activity: the newer of the item itself and its latest topic. */
  activeAt: Date;
  /** The agent's direct Channel, when the row opens it. Carries its own archive / trash actions. */
  channel?: ChannelListItem;
  item: SidebarAgentItem;
  /** One-line preview from the latest topic (assistant reply, else title). */
  preview?: string;
  /** Unread messages of the agent's direct Channel, when the row opens it. */
  unread?: number;
}

export interface ConversationSections {
  pinned: Conversation[];
  recent: Conversation[];
}

const recentOwnerId = (recent: RecentItem): string | undefined => {
  if (recent.type !== 'topic') return;
  // Group topics created by `execGroupAgent` persist the supervisor's `agentId`
  // *and* the group route, so the route decides ownership: reading `agentId`
  // first credits the group's replies to the supervisor and the group row never
  // picks up its own activity.
  const groupId = recent.routePath.match(/\/group\/([^/?#]+)/)?.[1];
  return groupId ?? recent.agentId ?? undefined;
};

const toTime = (value: Date | string) => new Date(value).getTime();

const oneLine = (text: string | null | undefined) =>
  (text ?? '').replaceAll(/\s+/g, ' ').trim() || undefined;

/** A Channel's latest message as one line of plain text. */
export const channelPreview = (channel: Pick<ChannelListItem, 'lastMessage'>) =>
  channel.lastMessage ? oneLine(markdownToTxt(channel.lastMessage.content)) : undefined;

/** When a Channel last had a message, else when it was opened. */
export const channelActivity = (channel: ChannelListItem): Date =>
  new Date(channel.lastMessage?.createdAt ?? channel.updatedAt ?? channel.createdAt);

/** Newest topic per owner (agent id, or the group named by the topic route). */
const topicsByOwner = (recents: RecentItem[] | undefined): Map<string, RecentItem> => {
  const latest = new Map<string, RecentItem>();
  for (const recent of recents ?? []) {
    const owner = recentOwnerId(recent);
    if (!owner) continue;
    const current = latest.get(owner);
    if (!current || toTime(recent.updatedAt) > toTime(current.updatedAt)) latest.set(owner, recent);
  }
  return latest;
};

/**
 * One owner's latest topic. The inbox row is not part of `items`, so it asks
 * for its own activity instead of going through the sections builder.
 */
export const latestTopicOf = (
  recents: RecentItem[] | undefined,
  ownerId: string | undefined,
): RecentItem | undefined => (ownerId ? topicsByOwner(recents).get(ownerId) : undefined);

/** The newer of an entity's own timestamp and its latest topic. */
export const latestActivity = (
  own: Date | string | undefined,
  topic: RecentItem | undefined,
): Date | undefined => {
  const ownTime = own ? toTime(own) : 0;
  const topicTime = topic ? toTime(topic.updatedAt) : 0;
  if (!ownTime && !topicTime) return undefined;
  return new Date(Math.max(ownTime, topicTime));
};

/** The inbox row's activity: once it opens a direct Channel, that replaces its legacy topics. */
export const inboxActivity = (
  own: Date | string | undefined,
  topic: RecentItem | undefined,
  direct?: ChannelListItem,
): Date | undefined =>
  direct
    ? new Date(Math.max(own ? toTime(own) : 0, channelActivity(direct).getTime()))
    : latestActivity(own, topic);

/**
 * Turn the sidebar agent/group list into IM-style conversations: each row
 * carries a preview of its latest topic and is ordered by latest activity,
 * pinned rows first.
 */
export const buildConversationSections = (
  items: SidebarAgentItem[],
  recents: RecentItem[] | undefined,
  /** The person's direct Channel per agent id. A row that opens one shows that conversation. */
  directChannels?: Map<string, ChannelListItem>,
): ConversationSections => {
  const latestByOwner = topicsByOwner(recents);

  const seen = new Set<string>();
  const conversations: Conversation[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    const itemTime = toTime(item.updatedAt);
    const direct = directChannels?.get(item.id);
    if (direct) {
      // The row opens the direct Channel, so its legacy topics no longer describe it.
      conversations.push({
        activeAt: new Date(Math.max(itemTime, channelActivity(direct).getTime())),
        channel: direct,
        item,
        preview: channelPreview(direct) ?? oneLine(item.description),
        unread: direct.unreadCount ?? 0,
      });
      continue;
    }

    const latest = latestByOwner.get(item.id);
    const latestTime = latest ? toTime(latest.updatedAt) : 0;

    conversations.push({
      activeAt: new Date(Math.max(itemTime, latestTime)),
      item,
      preview:
        (latest?.lastAssistantMessage || latest?.title || item.description || '')
          .replaceAll(/\s+/g, ' ')
          .trim() || undefined,
    });
  }

  conversations.sort((a, b) => b.activeAt.getTime() - a.activeAt.getTime());

  return {
    pinned: conversations.filter((c) => c.item.pinned),
    recent: conversations.filter((c) => !c.item.pinned),
  };
};

export type ConversationEntry =
  | { activeAt: Date; channel?: ChannelListItem; type: 'inbox' }
  | { activeAt: Date; channel: ChannelListItem; type: 'channel' }
  | (Conversation & { type: 'item' });

/**
 * One IM list like WeChat's: pinned rows first, then everything else by latest
 * activity. Lobe AI and group Channels are ordinary rows placed by their own
 * activity, not pinned to the top; a name / title filter narrows the whole list.
 */
export const buildConversationEntries = (
  { pinned, recent }: ConversationSections,
  inbox: { activeAt?: Date; channel?: ChannelListItem; title: string } | undefined,
  query = '',
  channels: ChannelListItem[] = [],
): ConversationEntry[] => {
  const keyword = query.trim().toLowerCase();
  const matches = (...names: (string | null | undefined)[]) =>
    !keyword || names.some((name) => (name ?? '').toLowerCase().includes(keyword));

  // Rows show the personal name when set (`agentDisplayName`), so match it as
  // well as the role title.
  const items = (list: Conversation[]): ConversationEntry[] =>
    list
      .filter((c) => matches(c.item.name, c.item.title))
      .map((c) => ({ ...c, type: 'item' as const }));

  const rest = [
    ...items(recent),
    ...channels
      .filter((channel) => matches(channel.title))
      .map((channel) => ({
        activeAt: channelActivity(channel),
        channel,
        type: 'channel' as const,
      })),
  ].sort((a, b) => b.activeAt.getTime() - a.activeAt.getTime());
  if (inbox && matches(inbox.title)) {
    const activeAt = inbox.activeAt ?? new Date(0);
    const index = rest.findIndex((entry) => entry.activeAt.getTime() < activeAt.getTime());
    rest.splice(index === -1 ? rest.length : index, 0, {
      activeAt,
      channel: inbox.channel,
      type: 'inbox',
    });
  }

  return [...items(pinned), ...rest];
};

/** IM-style timestamp: time today, weekday this week, date otherwise. */
export const formatConversationTime = (date: Date, now: Date = new Date()): string => {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = date.getTime();
  const pad = (n: number) => String(n).padStart(2, '0');

  if (time >= startOfToday) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}/${date.getDate()}`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
};

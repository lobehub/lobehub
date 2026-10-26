import type { RecentItem, SidebarAgentItem } from '@lobechat/types';

export interface Conversation {
  /** Latest activity: the newer of the item itself and its latest topic. */
  activeAt: Date;
  item: SidebarAgentItem;
  /** One-line preview from the latest topic (assistant reply, else title). */
  preview?: string;
}

export interface ConversationSections {
  pinned: Conversation[];
  recent: Conversation[];
}

const recentOwnerId = (recent: RecentItem): string | undefined => {
  if (recent.type !== 'topic') return;
  if (recent.agentId) return recent.agentId;
  // Group topics carry no agentId; their route names the group.
  return recent.routePath.match(/\/group\/([^/?#]+)/)?.[1];
};

const toTime = (value: Date | string) => new Date(value).getTime();

/**
 * Turn the sidebar agent/group list into IM-style conversations: each row
 * carries a preview of its latest topic and is ordered by latest activity,
 * pinned rows first.
 */
export const buildConversationSections = (
  items: SidebarAgentItem[],
  recents: RecentItem[] | undefined,
): ConversationSections => {
  const latestByOwner = new Map<string, RecentItem>();
  for (const recent of recents ?? []) {
    const owner = recentOwnerId(recent);
    if (!owner) continue;
    const current = latestByOwner.get(owner);
    if (!current || toTime(recent.updatedAt) > toTime(current.updatedAt))
      latestByOwner.set(owner, recent);
  }

  const seen = new Set<string>();
  const conversations: Conversation[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    const latest = latestByOwner.get(item.id);
    const itemTime = toTime(item.updatedAt);
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
  { activeAt: Date; type: 'inbox' } | (Conversation & { type: 'item' });

/**
 * One IM list like WeChat's: pinned rows first, then everything else by latest
 * activity. Lobe AI is an ordinary row placed by its own activity, not pinned
 * to the top; a title filter narrows the whole list.
 */
export const buildConversationEntries = (
  { pinned, recent }: ConversationSections,
  inbox: { activeAt?: Date; title: string } | undefined,
  query = '',
): ConversationEntry[] => {
  const keyword = query.trim().toLowerCase();
  const matches = (title: string | null | undefined) =>
    !keyword || (title ?? '').toLowerCase().includes(keyword);

  const items = (list: Conversation[]): ConversationEntry[] =>
    list
      .filter((c) => matches(c.item.title ?? c.item.name))
      .map((c) => ({ ...c, type: 'item' as const }));

  const rest = items(recent);
  if (inbox && matches(inbox.title)) {
    const activeAt = inbox.activeAt ?? new Date(0);
    const index = rest.findIndex((entry) => entry.activeAt.getTime() < activeAt.getTime());
    rest.splice(index === -1 ? rest.length : index, 0, { activeAt, type: 'inbox' });
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

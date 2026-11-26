import { INBOX_SESSION_ID } from '@lobechat/const';
import type { SidebarAgentItem } from '@lobechat/types';

const isInboxRow = (item: Pick<SidebarAgentItem, 'slug'>) => item.slug === INBOX_SESSION_ID;

export interface LiftedInboxRow<T extends Record<string, SidebarAgentItem[]>> {
  /** Lobe AI's row, when any of the lists carries it. */
  inbox?: SidebarAgentItem;
  /** The same lists with Lobe AI taken out. */
  lists: T;
}

/**
 * Lobe AI (the inbox), the default Agent, always leads the sidebar. It arrives
 * as an ordinary list item, so it can be pinned, filed in a folder or hidden
 * like any Agent; this takes its row out of whichever lists hold it so the
 * caller can render it first. A hidden Lobe AI is already gone from the lists
 * and stays gone.
 */
export const liftInboxRow = <T extends Record<string, SidebarAgentItem[]>>(
  lists: T,
): LiftedInboxRow<T> => {
  let inbox: SidebarAgentItem | undefined;
  const out = {} as Record<string, SidebarAgentItem[]>;

  for (const [key, list] of Object.entries(lists)) {
    out[key] = list.filter((item) => {
      if (!isInboxRow(item)) return true;
      inbox ??= item;
      return false;
    });
  }

  return { inbox, lists: out as T };
};

/** {@link liftInboxRow} for folders: their items lose Lobe AI's row. */
export const withoutInboxInGroups = <G extends { items: SidebarAgentItem[] }>(
  groups: G[],
): { groups: G[]; inbox?: SidebarAgentItem } => {
  let inbox: SidebarAgentItem | undefined;
  const out = groups.map((group) => {
    const { inbox: found, lists } = liftInboxRow({ items: group.items });
    inbox ??= found;
    return found ? { ...group, items: lists.items } : group;
  });

  return { groups: out, inbox };
};

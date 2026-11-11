import { agentDisplayName, type SidebarAgentItem } from '@lobechat/types';

import type { ContactListSortBy } from '@/store/global/initialState';

export const CONTACT_SORT_BYS: ContactListSortBy[] = ['title', 'updatedAt'];

const byTitle = (fallback: string) => (a: SidebarAgentItem, b: SidebarAgentItem) =>
  agentDisplayName(a, fallback).localeCompare(agentDisplayName(b, fallback), 'zh-Hans-CN');

/** Newest first; equal times fall back to the name so the order stays stable. */
const byUpdatedAt = (fallback: string) => {
  const title = byTitle(fallback);
  return (a: SidebarAgentItem, b: SidebarAgentItem) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() || title(a, b);
};

export const sortContacts = (
  items: SidebarAgentItem[],
  sortBy: ContactListSortBy,
  fallback: string,
) => [...items].sort(sortBy === 'updatedAt' ? byUpdatedAt(fallback) : byTitle(fallback));

/**
 * The contact list's sections, each in the chosen order: pinned contacts of either kind lead in
 * their own section and are left out of the groups and agents below.
 */
export const groupContacts = (
  items: SidebarAgentItem[],
  sortBy: ContactListSortBy,
  fallback: string,
) => {
  const sorted = sortContacts(items, sortBy, fallback);
  const rest = sorted.filter((item) => !item.pinned);
  return {
    agents: rest.filter((item) => item.type !== 'group'),
    groups: rest.filter((item) => item.type === 'group'),
    pinned: sorted.filter((item) => item.pinned),
  };
};

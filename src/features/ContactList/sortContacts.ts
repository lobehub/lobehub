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

import type { SidebarAgentListResponse } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

/** The sidebar agent list is one entry per scope. */
export const AGENT_LIST_KEY = 'sidebar';

/** Sidebar agents (pinned / grouped / ungrouped, plus private buckets). */
export const agentListResource = defineReplica<Record<string, never>, SidebarAgentListResponse>({
  key: () => AGENT_LIST_KEY,
  name: 'agentList',
  // localStorage: the sidebar is the first thing painted on boot.
  storage: 'localStorage',
  version: 1,
});

import { type PluginItem } from '@lobehub/market-sdk';

import { definePagedReplica } from '@/libs/replica';
import { type McpConnectionType } from '@/types/discover';

import { type MCPPluginListData } from './initialState';

/**
 * The MCP marketplace list is not partitioned per container: one entry per
 * scope, so every sync shares this key.
 */
export const MCP_PLUGIN_LIST_KEY = 'all';

/**
 * Query identity of one page set. `page` is NOT here — it is the paging cursor,
 * owned by the replica. `locale` and `connectionType` change the rows the
 * server returns, so a projection taken under other values never paints.
 */
export interface MCPPluginListParams {
  connectionType?: McpConnectionType;
  locale: string;
  pageSize: number;
  q?: string;
}

/**
 * The MCP marketplace list (`discoverService.getMCPPluginList`): a local-first
 * paged replica, so the skill store paints the persisted head page on the first
 * frame, the network confirms it, and "load more" appends further pages.
 */
export const mcpPluginListResource = definePagedReplica<
  MCPPluginListParams,
  PluginItem,
  number,
  MCPPluginListData
>({
  key: () => MCP_PLUGIN_LIST_KEY,
  name: 'mcpPluginList',
  paging: {
    direction: 'forward',
    getId: (item) => item.identifier,
    mode: 'offset',
    // A reload repaints what the first network page would show, never a stale tail.
    persist: { pages: 1 },
  },
  query: ({ connectionType, locale, pageSize, q }) => ({
    connectionType,
    locale,
    pageSize,
    q: q || undefined,
  }),
  storage: 'indexedDB',
  version: 1,
});

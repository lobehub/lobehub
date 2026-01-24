import { type LobeToolMeta } from '@lobechat/types';

import { shouldEnableTool } from '@/helpers/toolFilters';

import type { ToolStoreState } from '../../initialState';
import { KlavisServerStatus } from '../klavisStore';

export interface LobeToolMetaWithAvailability extends LobeToolMeta {
  /**
   * Whether the tool is available in web environment
   * e.g., LocalSystem is desktop-only, so availableInWeb is false
   */
  availableInWeb: boolean;
}

const toBuiltinMeta = (t: ToolStoreState['builtinTools'][number]): LobeToolMeta => ({
  author: 'LobeHub',
  identifier: t.identifier,
  meta: t.manifest.meta,
  type: 'builtin' as const,
});

const toBuiltinMetaWithAvailability = (
  t: ToolStoreState['builtinTools'][number],
): LobeToolMetaWithAvailability => ({
  ...toBuiltinMeta(t),
  availableInWeb: shouldEnableTool(t.identifier),
});

const getKlavisMetas = (s: ToolStoreState): LobeToolMeta[] =>
  (s.servers || [])
    .filter((server) => server.status === KlavisServerStatus.CONNECTED && server.tools?.length)
    .map((server) => ({
      author: 'Klavis',
      // Use identifier as storage identifier (e.g., 'google-calendar')
      identifier: server.identifier,
      meta: {
        avatar: '☁️',
        description: `LobeHub Mcp Server: ${server.serverName}`,
        tags: ['klavis', 'mcp'],
        // title still uses serverName to display friendly name
        title: server.serverName,
      },
      type: 'builtin' as const,
    }));

const getKlavisMetasWithAvailability = (s: ToolStoreState): LobeToolMetaWithAvailability[] =>
  getKlavisMetas(s).map((meta) => ({ ...meta, availableInWeb: true }));

/**
 * Get visible builtin tools meta list (excludes hidden tools)
 * Used for general tool display in chat input bar
 */
const metaList = (s: ToolStoreState): LobeToolMeta[] => {
  const builtinMetas = s.builtinTools
    .filter((item) => {
      // Filter hidden tools
      if (item.hidden) return false;

      // Filter platform-specific tools (e.g., LocalSystem desktop-only)
      if (!shouldEnableTool(item.identifier)) return false;

      return true;
    })
    .map(toBuiltinMeta);

  return [...builtinMetas, ...getKlavisMetas(s)];
};

// Tools that should never be exposed in agent profile configuration
const EXCLUDED_TOOLS = new Set([
  'lobe-agent-builder',
  'lobe-group-agent-builder',
  'lobe-group-management',
]);

/**
 * Get all builtin tools meta list (includes hidden tools and platform-specific tools)
 * Used for agent profile tool configuration where all tools should be configurable
 * Returns availability info so UI can show hints for unavailable tools
 */
const allMetaList = (s: ToolStoreState): LobeToolMetaWithAvailability[] => {
  const builtinMetas = s.builtinTools
    .filter((item) => {
      // Exclude internal tools that should not be user-configurable
      if (EXCLUDED_TOOLS.has(item.identifier)) return false;

      return true;
    })
    .map(toBuiltinMetaWithAvailability);

  return [...builtinMetas, ...getKlavisMetasWithAvailability(s)];
};

export const builtinToolSelectors = {
  allMetaList,
  metaList,
};

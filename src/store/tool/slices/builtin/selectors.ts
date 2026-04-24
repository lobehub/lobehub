import { runtimeManagedToolIds } from '@lobechat/builtin-tools';
import { type BuiltinSkill, type LobeToolMeta } from '@lobechat/types';

import {
  isBuiltinSkillAvailableInCurrentEnv,
  isBuiltinToolAvailableInCurrentEnv,
} from '@/helpers/toolAvailability';

import { type ToolStoreState } from '../../initialState';
import { agentSkillsSelectors } from '../agentSkills/selectors';
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
  availableInWeb: isBuiltinToolAvailableInCurrentEnv(t.identifier),
});

const toSkillMeta = (s: BuiltinSkill): LobeToolMeta => ({
  author: 'LobeHub',
  identifier: s.identifier,
  meta: {
    avatar: s.avatar,
    description: s.description,
    title: s.name,
  },
  type: 'builtin' as const,
});

const toSkillMetaWithAvailability = (s: BuiltinSkill): LobeToolMetaWithAvailability => ({
  ...toSkillMeta(s),
  availableInWeb: isBuiltinSkillAvailableInCurrentEnv(s.identifier),
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

// Set form for O(1) lookup inside the filter loop.
const RUNTIME_MANAGED_TOOL_IDS = new Set(runtimeManagedToolIds);
const USER_HIDDEN_BUILTIN_TOOL_IDS = new Set(['lobe-task']);

/**
 * Shared list builder for the chat-input Tools popover.
 * @param includeHidden When true, includes builtin tools whose `hidden` flag is set
 * (e.g. memory, agent-management). Used by the manual skill-activate mode so users
 * can explicitly toggle the otherwise auto-activated tools.
 *
 * Two categories of hidden tools are STILL excluded even when `includeHidden` is true:
 * 1. Tools with `discoverable: false` — the project-wide signal for "infrastructure /
 *    internal, never user-facing" (the activator and `availableToolsForDiscovery`
 *    selector both honor it).
 * 2. Tools listed in `runtimeManagedToolIds` — these have their enabled state forced
 *    by `AgentToolsEngine` runtime rules (e.g. cloud-sandbox is on iff cloud runtime,
 *    web-browsing is on iff search enabled, agent-documents is on iff agent has docs).
 *    Showing a toggle the user can't actually affect would be a UI lie.
 */
const buildVisibleMetaList = (
  s: ToolStoreState,
  { includeHidden }: { includeHidden: boolean },
): LobeToolMeta[] => {
  const { uninstalledBuiltinTools } = s;

  const builtinMetas = s.builtinTools
    .filter((item) => {
      // Filter hidden tools (unless caller opts in)
      if (item.hidden && !includeHidden) return false;
      // Even when `includeHidden` is true, never expose pure infra tools.
      if (includeHidden && item.discoverable === false) return false;
      // Even when `includeHidden` is true, never expose runtime-rule-controlled tools
      // (their enabled state is forced by AgentToolsEngine rules; user toggles would
      // be a no-op and create UI/state mismatch).
      if (includeHidden && RUNTIME_MANAGED_TOOL_IDS.has(item.identifier)) return false;
      // Task tools are enabled by scenario/page context and should not be user-toggleable.
      if (includeHidden && USER_HIDDEN_BUILTIN_TOOL_IDS.has(item.identifier)) return false;

      // Filter platform-specific tools (e.g., LocalSystem desktop-only)
      if (!isBuiltinToolAvailableInCurrentEnv(item.identifier)) return false;

      // Exclude uninstalled tools
      if (uninstalledBuiltinTools.includes(item.identifier)) {
        return false;
      }

      return true;
    })
    .map(toBuiltinMeta);

  const skillMetas = (s.builtinSkills || [])
    .filter((skill) => {
      if (!isBuiltinSkillAvailableInCurrentEnv(skill.identifier)) return false;
      if (uninstalledBuiltinTools.includes(skill.identifier)) return false;

      return true;
    })
    .map(toSkillMeta);
  const agentSkillMetas = agentSkillsSelectors.agentSkillMetaList(s);

  return [...skillMetas, ...agentSkillMetas, ...builtinMetas, ...getKlavisMetas(s)];
};

/**
 * Get visible builtin tools meta list (excludes hidden tools)
 * Used for general tool display in chat input bar
 * Only returns tools that are not in the uninstalledBuiltinTools list
 */
const metaList = (s: ToolStoreState): LobeToolMeta[] =>
  buildVisibleMetaList(s, { includeHidden: false });

/**
 * Same as `metaList` but also surfaces builtin tools that are normally hidden
 * (e.g. web-browsing, cloud-sandbox). Used by the chat-input Tools popover when
 * the agent is in manual skill-activate mode so users can explicitly enable or
 * disable tools the activator would otherwise auto-activate.
 *
 * Pure infrastructure tools (the activator itself, agent-builder helpers, etc.)
 * are still excluded — they are never user-toggleable.
 */
const metaListIncludingHidden = (s: ToolStoreState): LobeToolMeta[] =>
  buildVisibleMetaList(s, { includeHidden: true });

// Tools that should never be exposed in agent profile configuration
const EXCLUDED_TOOLS = new Set([
  'lobe-agent-builder',
  'lobe-group-agent-builder',
  'lobe-group-management',
  'lobe-skills',
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

  const skillMetas = (s.builtinSkills || []).map(toSkillMetaWithAvailability);
  const agentSkillMetas = agentSkillsSelectors
    .agentSkillMetaList(s)
    .map((meta) => ({ ...meta, availableInWeb: true }));

  return [...skillMetas, ...agentSkillMetas, ...builtinMetas, ...getKlavisMetasWithAvailability(s)];
};

/**
 * Get installed builtin tools meta list (excludes uninstalled, includes hidden and platform-specific)
 * Used for agent profile tool configuration where only installed tools should be shown
 */
const installedAllMetaList = (s: ToolStoreState): LobeToolMetaWithAvailability[] => {
  const { uninstalledBuiltinTools } = s;

  const builtinMetas = s.builtinTools
    .filter((item) => {
      if (EXCLUDED_TOOLS.has(item.identifier)) return false;
      if (USER_HIDDEN_BUILTIN_TOOL_IDS.has(item.identifier)) return false;
      if (uninstalledBuiltinTools.includes(item.identifier)) return false;

      return true;
    })
    .map(toBuiltinMetaWithAvailability);

  return [...builtinMetas, ...getKlavisMetasWithAvailability(s)];
};

/**
 * Get installed builtin skills (excludes uninstalled ones)
 */
const installedBuiltinSkills = (s: ToolStoreState): BuiltinSkill[] =>
  (s.builtinSkills || []).filter((skill) => {
    if (!isBuiltinSkillAvailableInCurrentEnv(skill.identifier)) return false;
    if (s.uninstalledBuiltinTools.includes(skill.identifier)) return false;

    return true;
  });

/**
 * Get uninstalled builtin tool identifiers
 */
const uninstalledBuiltinTools = (s: ToolStoreState): string[] => s.uninstalledBuiltinTools;

/**
 * Check if a builtin tool is installed
 */
const isBuiltinToolInstalled = (identifier: string) => (s: ToolStoreState) =>
  !s.uninstalledBuiltinTools.includes(identifier);

export const builtinToolSelectors = {
  allMetaList,
  installedAllMetaList,
  installedBuiltinSkills,
  isBuiltinToolInstalled,
  metaList,
  metaListIncludingHidden,
  uninstalledBuiltinTools,
};

export { USER_HIDDEN_BUILTIN_TOOL_IDS };

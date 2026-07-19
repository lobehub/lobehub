import {
  activationModeControlledToolIds,
  alwaysOnToolIds,
  manualModeExcludeToolIds,
  runtimeManagedToolIds,
} from '@lobechat/builtin-tools';
import type { BuiltinSkill, LobeToolMeta } from '@lobechat/types';

import {
  isBuiltinSkillAvailableInCurrentEnv,
  isBuiltinToolAvailableInCurrentEnv,
} from '@/helpers/toolAvailability';

import type { ToolStoreState } from '../../initialState';
import { agentSkillsSelectors } from '../agentSkills/selectors';
import { ComposioServerStatus } from '../composioStore';

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

const getComposioMetas = (s: ToolStoreState): LobeToolMeta[] =>
  (s.composioServers || [])
    .filter((server) => server.status === ComposioServerStatus.ACTIVE && server.tools?.length)
    .map((server) => ({
      author: 'Composio',
      // Use identifier as storage identifier (e.g., 'google-calendar')
      identifier: server.identifier,
      meta: {
        avatar: '☁️',
        description: `LobeHub Mcp Server: ${server.label}`,
        tags: ['composio', 'mcp'],
        title: server.label,
      },
      type: 'builtin' as const,
    }));

const getComposioMetasWithAvailability = (s: ToolStoreState): LobeToolMetaWithAvailability[] =>
  getComposioMetas(s).map((meta) => ({ ...meta, availableInWeb: true }));

// Set form for O(1) lookup inside the filter loop.
const RUNTIME_MANAGED_TOOL_IDS = new Set(runtimeManagedToolIds);
const ALWAYS_ON_TOOL_IDS = new Set(alwaysOnToolIds);
const MANUAL_MODE_EXCLUDE_TOOL_IDS = new Set(manualModeExcludeToolIds);

interface ProfileConfigurableToolOptions {
  isManualMode: boolean;
}

/**
 * Agent Profile only owns tools whose lifecycle can genuinely be controlled by
 * the agent's plugin policy. Runtime-managed tools (for example Web Browsing),
 * non-discoverable infrastructure, and system-fixed tools do not satisfy that
 * contract. A default tool removed specifically by manual activation mode is
 * the exception: an explicit profile pin genuinely adds it back.
 */
const isProfileConfigurableBuiltinTool = (
  tool: ToolStoreState['builtinTools'][number],
  { isManualMode }: ProfileConfigurableToolOptions,
): boolean => {
  if (tool.discoverable === false) return false;
  if (RUNTIME_MANAGED_TOOL_IDS.has(tool.identifier)) return false;

  return (
    !ALWAYS_ON_TOOL_IDS.has(tool.identifier) ||
    (isManualMode && MANUAL_MODE_EXCLUDE_TOOL_IDS.has(tool.identifier))
  );
};

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
 *    web-browsing is on iff search is enabled).
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

  return [...skillMetas, ...agentSkillMetas, ...builtinMetas, ...getComposioMetas(s)];
};

/**
 * Get visible builtin tools meta list (excludes hidden tools)
 * Used for general tool display in chat input bar
 * Only returns tools that are not in the uninstalledBuiltinTools list
 */
const metaList = (s: ToolStoreState): LobeToolMeta[] =>
  buildVisibleMetaList(s, { includeHidden: false });

/**
 * Same as `metaList` but also surfaces eligible builtin tools that are normally
 * hidden (e.g. task and agent-management). Used by the chat-input Tools popover
 * when the agent is in manual skill-activate mode.
 *
 * Pure infrastructure and runtime-managed tools are still excluded because the
 * user's toggle cannot truthfully control them.
 */
const metaListIncludingHidden = (s: ToolStoreState): LobeToolMeta[] =>
  buildVisibleMetaList(s, { includeHidden: true });

// Legacy exclusions for broad metadata inventories. Agent Profile visibility
// is governed by `isProfileConfigurableBuiltinTool` instead.
const EXCLUDED_TOOLS = new Set([
  'lobe-agent-builder',
  'lobe-group-agent-builder',
  'lobe-group-management',
  'lobe-skills',
]);

/**
 * Get broad builtin-tool metadata (including hidden/platform-specific tools).
 * Used by detail, lookup, and context-building surfaces rather than as a
 * user-configurable Agent Profile list.
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

  return [
    ...skillMetas,
    ...agentSkillMetas,
    ...builtinMetas,
    ...getComposioMetasWithAvailability(s),
  ];
};

/**
 * Get installed discoverable builtin tools and skills.
 * Excludes only tools with `discoverable: false` (pure infrastructure / internal).
 * Includes hidden and runtime-managed tools (web-browsing, memory, cloud-sandbox, etc.).
 */
const discoverableMetaList = (s: ToolStoreState): LobeToolMeta[] => {
  const { uninstalledBuiltinTools } = s;

  const skillMetas = (s.builtinSkills || [])
    .filter((skill) => {
      if (!isBuiltinSkillAvailableInCurrentEnv(skill.identifier)) return false;
      if (uninstalledBuiltinTools.includes(skill.identifier)) return false;
      return true;
    })
    .map(toSkillMeta);

  const agentSkillMetas = agentSkillsSelectors.agentSkillMetaList(s);

  const builtinMetas = s.builtinTools
    .filter((item) => {
      // Exclude pure infrastructure tools (never user-facing)
      if (item.discoverable === false) return false;
      if (uninstalledBuiltinTools.includes(item.identifier)) return false;
      return true;
    })
    .map(toBuiltinMeta);

  return [...skillMetas, ...agentSkillMetas, ...builtinMetas, ...getComposioMetas(s)];
};

/**
 * Get broad installed builtin-tool metadata (including hidden and
 * platform-specific tools). This is an inventory/lookup selector; Agent
 * Profile uses `installedProfileConfigurableMetaList` for its picker.
 */
const installedAllMetaList = (s: ToolStoreState): LobeToolMetaWithAvailability[] => {
  const { uninstalledBuiltinTools } = s;

  const builtinMetas = s.builtinTools
    .filter((item) => {
      if (EXCLUDED_TOOLS.has(item.identifier)) return false;
      if (uninstalledBuiltinTools.includes(item.identifier)) return false;

      return true;
    })
    .map(toBuiltinMetaWithAvailability);

  return [...builtinMetas, ...getComposioMetasWithAvailability(s)];
};

/**
 * Installed builtin tools that Agent Profile can truthfully pin or unpin.
 *
 * This intentionally differs from `installedAllMetaList`, which is also used
 * by inventory/detail surfaces and therefore contains runtime-managed and
 * internal tools for lookup purposes.
 */
const installedProfileConfigurableMetaList =
  (options: ProfileConfigurableToolOptions) =>
  (s: ToolStoreState): LobeToolMetaWithAvailability[] => {
    const { uninstalledBuiltinTools } = s;

    const builtinMetas = s.builtinTools
      .filter((tool) => isProfileConfigurableBuiltinTool(tool, options))
      .filter((item) => !uninstalledBuiltinTools.includes(item.identifier))
      .map(toBuiltinMetaWithAvailability);

    return [...builtinMetas, ...getComposioMetasWithAvailability(s)];
  };

/**
 * Builtin identifiers hidden from Agent Profile in the current activation
 * mode. Their config entries remain intact so switching modes is reversible.
 */
const nonProfileConfigurableBuiltinToolIds =
  (options: ProfileConfigurableToolOptions) =>
  (s: ToolStoreState): string[] =>
    s.builtinTools
      .filter((tool) => !isProfileConfigurableBuiltinTool(tool, options))
      .map((tool) => tool.identifier);

const ACTIVATION_MODE_CONTROLLED_TOOL_IDS = new Set(activationModeControlledToolIds);

/**
 * Get meta for builtin runtime tools that default to pinned and should be shown in the
 * chat-input Tools popover. Their per-agent policy supports pinned or disabled.
 *
 * These tools are normally `hidden` (and some are `discoverable: false`), so they never
 * appear in `metaList` / `metaListIncludingHidden`. Here we read them directly from
 * `builtinTools` by identifier, preserving the `alwaysOnToolIds` order and dropping any
 * that aren't available in the current environment.
 *
 * The list must match what the engine actually enables: in manual skill-activate mode the
 * discovery tools in `manualModeExcludeToolIds` (activator, skill-store) are stripped from
 * the defaults before the enable checker runs, so they are NOT on — exclude them here too,
 * otherwise the UI would claim a fixed tool that the runtime omits.
 */
const fixedDisplayMetaList =
  ({ isManualMode }: { isManualMode: boolean } = { isManualMode: false }) =>
  (s: ToolStoreState): LobeToolMeta[] =>
    alwaysOnToolIds
      .filter((id) => !ACTIVATION_MODE_CONTROLLED_TOOL_IDS.has(id))
      .filter((id) => !(isManualMode && MANUAL_MODE_EXCLUDE_TOOL_IDS.has(id)))
      .map((id) => s.builtinTools.find((tool) => tool.identifier === id))
      .filter((tool): tool is ToolStoreState['builtinTools'][number] => !!tool)
      .filter((tool) => isBuiltinToolAvailableInCurrentEnv(tool.identifier))
      .map(toBuiltinMeta);

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
  discoverableMetaList,
  fixedDisplayMetaList,
  installedAllMetaList,
  installedBuiltinSkills,
  installedProfileConfigurableMetaList,
  isBuiltinToolInstalled,
  metaList,
  metaListIncludingHidden,
  nonProfileConfigurableBuiltinToolIds,
  uninstalledBuiltinTools,
};

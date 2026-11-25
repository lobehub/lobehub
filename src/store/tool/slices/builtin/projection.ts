import { onDemandBuiltinToolIds } from '@lobechat/builtin-tools';
import {
  getImplicitBuiltinSkillIds,
  getLegacyDisabledBuiltinSkillIds,
  legacyBuiltinSkillIds,
  type SkillDiscoveryChatConfig,
} from '@lobechat/mecha/builtinSkillGate';
import type { AgentPluginEntry } from '@lobechat/types';
import { getBuiltinOverrides } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

import type { BuiltinToolState } from './initialState';

export { resolveUninstalledBuiltinTools } from '@lobechat/builtin-tools';

/**
 * The uninstalled-builtin list is one entry: the active identity
 * (`${userId}:${workspaceId ?? 'personal'}`) already partitions memory and
 * storage, so the entry key is a constant and personal / each workspace keep
 * independent rows automatically.
 */
export const UNINSTALLED_BUILTIN_TOOLS_KEY = 'uninstalled';

export interface UninstalledBuiltinToolsParams {
  /** Active workspace id, or `null` for the personal scope. */
  workspaceId: string | null;
}

/**
 * Uninstalled builtin tools (`settings.tool.uninstalledBuiltinTools` /
 * `uninstalledBuiltinToolsByWorkspace`): the user's own list, read on the
 * settings, skill-store and chat-input surfaces and written by install /
 * uninstall. A local-first replica paints the persisted list on the first
 * frame and lets the network confirm it in the background.
 *
 * The params carry the workspace the list belongs to so the fetch resolves the
 * matching slot even if the user switches workspace while the request is in
 * flight; the params do not change the entry key.
 */
export const uninstalledBuiltinToolsResource = defineReplica<
  UninstalledBuiltinToolsParams,
  string[]
>({
  key: () => UNINSTALLED_BUILTIN_TOOLS_KEY,
  name: 'uninstalledBuiltinTools',
  storage: 'indexedDB',
  version: 1,
});

/** A persisted or previous scope's projection may paint the UI before this scope is confirmed. */
export const confirmedUninstalledBuiltinTools = (state: BuiltinToolState) => {
  if (!state.isUninstalledBuiltinToolsInit) return undefined;
  const replica = state.uninstalledBuiltinToolsReplica;
  const entry = replica.entries[UNINSTALLED_BUILTIN_TOOLS_KEY];
  if (entry?.source !== 'server' || replica.scope !== uninstalledBuiltinToolsResource.scope.get()) {
    return undefined;
  }
  // Apply an uninstall immediately, but keep an installation unavailable until its write commits.
  return entry.base
    ? [...new Set([...entry.base, ...state.uninstalledBuiltinTools])]
    : state.uninstalledBuiltinTools;
};

export const runtimeUninstalledBuiltinTools = (state: BuiltinToolState) =>
  confirmedUninstalledBuiltinTools(state) ?? onDemandBuiltinToolIds;

/** A client run confirms the scoped uninstall list before preparing its tools. */
export const installedImplicitBuiltinSkillIds = (
  state: BuiltinToolState,
  createdAt: Date | string | undefined,
  chatConfig: SkillDiscoveryChatConfig | null | undefined,
) => {
  const implicit = getImplicitBuiltinSkillIds(createdAt, chatConfig);
  if (!implicit.length) return implicit;
  const uninstalled = confirmedUninstalledBuiltinTools(state);
  return uninstalled ? implicit.filter((id) => !uninstalled.includes(id)) : [];
};

/** A legacy uninstall remains off until this agent explicitly chooses the bundled skill. */
export const legacyDisabledBuiltinSkillsForRun = (
  state: BuiltinToolState,
  plugins: AgentPluginEntry[] | undefined,
) =>
  getLegacyDisabledBuiltinSkillIds(
    confirmedUninstalledBuiltinTools(state) ?? legacyBuiltinSkillIds,
    getBuiltinOverrides(plugins),
  );

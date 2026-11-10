import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { type AgentPluginMode } from '@lobechat/types';

import { type LobeAgentChatConfig } from '@/types/agent';

/**
 * Memory and web browsing are runtime-managed builtin tools: the shared engine
 * rules (`resolveToolRules`) enable them from chatConfig — `memory.enabled` for
 * memory, `searchMode` for web browsing — instead of from `agents.plugins`.
 *
 * The Tools popover still gives them the same Pinned/Auto/Disable policy as every
 * other row, so the on/off half of that policy is translated into a chatConfig
 * patch here. Keeping a single source of truth for on/off means the row, the
 * memory injection and the search wiring can never disagree about whether the
 * capability is on. The optional pin is recorded in `agents.plugins` like every
 * other skill — chatConfig only carries on/off — so Pinned and Auto share a patch.
 */
const CAPABILITY_CONFIG_PATCHES: Record<
  string,
  { off: Partial<LobeAgentChatConfig>; on: Partial<LobeAgentChatConfig> }
> = {
  [MemoryManifest.identifier]: {
    off: { memory: { enabled: false } },
    on: { memory: { enabled: true } },
  },
  [WebBrowsingManifest.identifier]: {
    off: { searchMode: 'off' },
    on: { searchMode: 'auto' },
  },
};

/**
 * Activation label a capability row shows. On/off comes from chatConfig rather than
 * from the plugin list, while `pinned` additionally records the explicit pin in
 * `agents.plugins` — that is what moves the row into the Pinned group.
 */
export const resolveCapabilityMode = (enabled: boolean, pinned = false): AgentPluginMode => {
  if (pinned) return 'pinned';

  return enabled ? 'auto' : 'disabled';
};

/** Whether `identifier`'s activation is backed by chatConfig rather than only `agents.plugins`. */
export const isCapabilityTool = (identifier: string): boolean =>
  identifier in CAPABILITY_CONFIG_PATCHES;

/**
 * chatConfig patch that applies `mode` to a capability tool, or `undefined` when the
 * identifier is not a capability tool (callers then fall back to the plugin policy).
 * Pinned and Auto both mean "on" — the difference is only where the explicit choice
 * is recorded — while Disabled means "off".
 */
export const resolveCapabilityConfigPatch = (
  identifier: string,
  mode: AgentPluginMode,
): Partial<LobeAgentChatConfig> | undefined => {
  const patches = CAPABILITY_CONFIG_PATCHES[identifier];
  if (!patches) return undefined;

  return mode === 'disabled' ? patches.off : patches.on;
};

/**
 * Single source of truth for "what counts as a device tool" — i.e. tools
 * whose execution can read or write the bot owner's machine and therefore
 * MUST be gated by `resolveDeviceAccessPolicy`. Adding a third device tool
 * means updating this file and nowhere else.
 *
 * Two related guarantees flow from this module:
 *
 *   1. `isDeviceToolIdentifier` — predicate used by the per-call audit
 *      (`deviceToolAudit.ts`) and the runtime executors so a non-device tool
 *      never falsely triggers a device-tool audit entry, and vice versa.
 *
 *   2. `buildAllowedBuiltinTools` — the **only** place that performs the
 *      physical filter on `builtinTools` before they reach the
 *      `ToolsEngine.manifestSchemas` or the activator-discovery
 *      `toolManifestMap`. Routing every builtin discovery through this
 *      helper closes the activator bypass documented in LOBE-8768 (an
 *      external sender could otherwise `activateTools(["lobe-remote-device"])`
 *      because the manifest was still resolvable in the engine even when
 *      the rule-layer gate denied it).
 */
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import { builtinTools } from '@lobechat/builtin-tools';

export const DEVICE_TOOL_MANIFESTS = [LocalSystemManifest, RemoteDeviceManifest] as const;

export const DEVICE_TOOL_IDENTIFIERS: ReadonlySet<string> = new Set(
  DEVICE_TOOL_MANIFESTS.map((m) => m.identifier),
);

export const isDeviceToolIdentifier = (identifier: string): boolean =>
  DEVICE_TOOL_IDENTIFIERS.has(identifier);

export interface AllowedBuiltinToolsParams {
  /**
   * Output of `resolveDeviceAccessPolicy`. When `false`, BOTH device tools
   * (local-system and remote-device) are stripped from the returned list —
   * this is the hard wall that keeps external bot senders from reaching the
   * owner's machine even via `lobe-activator`'s `isExplicitActivation`
   * bypass at the engine's enableChecker layer.
   */
  canUseDevice: boolean;
  /**
   * User-level kill switch for local-system specifically. Independent of
   * `canUseDevice` — an owner may want first-party local-system disabled
   * (privacy, sandbox tests) while remote-device stays available.
   * `undefined` is treated as `false` so callers that thread the
   * `disableLocalSystem?: boolean` param through don't need to coerce.
   */
  disableLocalSystem?: boolean;
}

/**
 * Physically filter the `builtinTools` array based on per-turn device
 * access. Callers MUST use this in place of iterating `builtinTools`
 * directly when the resulting manifests will reach a place the activator
 * (or the rendered `<available_tools>` block) can see.
 *
 * Defense-in-depth note: the rule-layer gates in `AgentToolsEngine` are
 * kept as a secondary line of defense, but they are bypassed by
 * `allowExplicitActivation` (LOBE-8768 B2), so the **physical** filter
 * here is the only reliable enforcement point.
 */
export const buildAllowedBuiltinTools = (params: AllowedBuiltinToolsParams) => {
  const { canUseDevice, disableLocalSystem } = params;

  return builtinTools.filter((tool) => {
    if (disableLocalSystem && tool.identifier === LocalSystemManifest.identifier) {
      return false;
    }
    if (!canUseDevice && DEVICE_TOOL_IDENTIFIERS.has(tool.identifier)) {
      return false;
    }
    return true;
  });
};

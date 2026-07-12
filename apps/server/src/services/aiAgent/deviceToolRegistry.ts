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
 *      helper closes the activator bypass documented in (an
 *      external sender could otherwise `activateTools(["lobe-remote-device"])`
 *      because the manifest was still resolvable in the engine even when
 *      the rule-layer gate denied it).
 */
import { BrowserManifest } from '@lobechat/builtin-tool-browser';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import { builtinTools } from '@lobechat/builtin-tools';

export const DEVICE_TOOL_MANIFESTS = [
  LocalSystemManifest,
  RemoteDeviceManifest,
  BrowserManifest,
] as const;

export const DEVICE_TOOL_IDENTIFIERS: ReadonlySet<string> = new Set(
  DEVICE_TOOL_MANIFESTS.map((m) => m.identifier),
);

/**
 * The remote-device picker alone — the exclusion set for device-LOCKED runs,
 * which keep local-system for the routed device but must not see the picker.
 */
export const REMOTE_DEVICE_TOOL_IDENTIFIERS: ReadonlySet<string> = new Set([
  RemoteDeviceManifest.identifier,
]);

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
   * The run is locked to a specific device — routed, or explicitly bound but
   * offline (see `isDeviceLockedPlan`). Strips `lobe-remote-device` ONLY:
   * with no device decision left, the picker must not exist (offering
   * `activateDevice` invites redundant activation or hopping to a machine
   * the user never chose), while local-system stays for the routed device.
   * Physical counterpart of the `!deviceLocked` rule gate in
   * `AgentToolsEngine` — without it, the activator's `isExplicitActivation`
   * bypass can re-surface the device list mid-run.
   */
  deviceLocked?: boolean;
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
 * `allowExplicitActivation` (B2), so the **physical** filter
 * here is the only reliable enforcement point.
 */
export const buildAllowedBuiltinTools = (params: AllowedBuiltinToolsParams) => {
  const { canUseDevice, deviceLocked, disableLocalSystem } = params;

  return builtinTools.filter((tool) => {
    if (disableLocalSystem && tool.identifier === LocalSystemManifest.identifier) {
      return false;
    }
    if (!canUseDevice && DEVICE_TOOL_IDENTIFIERS.has(tool.identifier)) {
      return false;
    }
    if (deviceLocked && REMOTE_DEVICE_TOOL_IDENTIFIERS.has(tool.identifier)) {
      return false;
    }
    return true;
  });
};

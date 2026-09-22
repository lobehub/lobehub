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
import { builtinTools } from '@lobechat/builtin-tools';
import {
  DEVICE_TOOL_IDENTIFIERS,
  DEVICE_TOOL_MANIFESTS,
  type DeviceToolWallParams,
  filterAllowedBuiltinTools,
  isDeviceToolIdentifier,
  REMOTE_DEVICE_TOOL_IDENTIFIERS,
} from '@lobechat/mecha';

// The registry and the walls live in `@lobechat/mecha` so both hosts agree
// on which builtin tools are device tools; re-exported for the server callers.
export {
  DEVICE_TOOL_IDENTIFIERS,
  DEVICE_TOOL_MANIFESTS,
  isDeviceToolIdentifier,
  REMOTE_DEVICE_TOOL_IDENTIFIERS,
};

export type AllowedBuiltinToolsParams = DeviceToolWallParams;

/** The bundled builtin tools that may exist for this run, after the device walls. */
export const buildAllowedBuiltinTools = (params: AllowedBuiltinToolsParams) =>
  filterAllowedBuiltinTools(builtinTools, params);

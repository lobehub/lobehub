import { AuvManifest } from '@lobechat/builtin-tool-auv';
import { BrowserManifest } from '@lobechat/builtin-tool-browser';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import type { LobeBuiltinTool } from '@lobechat/types';

/** Builtin tools that only exist for a run with a device (local machine or routed device). */
export const DEVICE_TOOL_MANIFESTS = [
  LocalSystemManifest,
  RemoteDeviceManifest,
  BrowserManifest,
  AuvManifest,
] as const;

export const DEVICE_TOOL_IDENTIFIERS: ReadonlySet<string> = new Set(
  DEVICE_TOOL_MANIFESTS.map((m) => m.identifier),
);

/** The picker that activates a device mid-run; pointless once the run is locked to one. */
export const REMOTE_DEVICE_TOOL_IDENTIFIERS: ReadonlySet<string> = new Set([
  RemoteDeviceManifest.identifier,
]);

export const isDeviceToolIdentifier = (identifier: string): boolean =>
  DEVICE_TOOL_IDENTIFIERS.has(identifier);

export interface DeviceToolWallParams {
  /** The run's access policy allows a device at all (external bot senders do not). */
  canUseDevice: boolean;
  /** The run is committed to one device (routed, or bound but offline). */
  deviceLocked?: boolean;
  disableLocalSystem?: boolean;
  /**
   * Tools the routed device reports supporting. `undefined` means no device
   * gateway is involved, so the opt-in check does not apply.
   */
  supportedDeviceTools?: readonly string[];
}

/**
 * Whether a builtin tool may physically exist in this run's manifest pool.
 * This is a wall, not a rule: explicit activation bypasses the enable rules,
 * so a tool the policy denies must not be resolvable at all.
 */
export const isBuiltinToolAllowed = (identifier: string, params: DeviceToolWallParams): boolean => {
  const { canUseDevice, deviceLocked, disableLocalSystem, supportedDeviceTools } = params;
  if (
    identifier === AuvManifest.identifier &&
    supportedDeviceTools !== undefined &&
    !supportedDeviceTools.includes(identifier)
  )
    return false;
  if (
    disableLocalSystem &&
    (identifier === LocalSystemManifest.identifier || identifier === AuvManifest.identifier)
  )
    return false;
  if (!canUseDevice && DEVICE_TOOL_IDENTIFIERS.has(identifier)) return false;
  if (deviceLocked && REMOTE_DEVICE_TOOL_IDENTIFIERS.has(identifier)) return false;
  return true;
};

export const filterAllowedBuiltinTools = <T extends Pick<LobeBuiltinTool, 'identifier'>>(
  tools: readonly T[],
  params: DeviceToolWallParams,
): T[] => tools.filter((tool) => isBuiltinToolAllowed(tool.identifier, params));

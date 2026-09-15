import { resolveRemotePlatformCommand } from '@lobechat/heterogeneous-agents/scanHost';

export interface CheckPlatformCapabilityParams {
  platform: string;
}

export interface CheckPlatformCapabilityResult {
  available: boolean;
  reason?: string;
  version?: string;
}

/**
 * Probe whether a specific agent platform is available on this device.
 * Dispatched by the server via `device.checkCapability` tRPC procedure.
 *
 * Uses the same validated executable and PATH recovery as host scanning,
 * profile lookup, and task execution so these surfaces cannot disagree.
 */
export async function checkPlatformCapability(
  params: CheckPlatformCapabilityParams,
): Promise<CheckPlatformCapabilityResult> {
  const { platform } = params;
  const status = await resolveRemotePlatformCommand(platform);

  if (!status.available) {
    return {
      available: false,
      reason: status.error ?? `${platform} was not found or failed validation`,
    };
  }

  return status.version ? { available: true, version: status.version } : { available: true };
}

import { execFileSync } from 'node:child_process';

export interface CheckPlatformCapabilityParams {
  platform: 'hermes' | 'openclaw';
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
 * - openclaw: runs `openclaw --version` and parses the output
 * - hermes:   hits the gateway health endpoint on the configured port
 */
export async function checkPlatformCapability(
  params: CheckPlatformCapabilityParams,
): Promise<CheckPlatformCapabilityResult> {
  const { platform } = params;

  if (platform === 'openclaw') {
    try {
      const output = execFileSync('openclaw', ['--version'], {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      // output is typically "openclaw x.y.z"
      const version = output.split(/\s+/).at(-1);
      return { available: true, version };
    } catch (err) {
      return {
        available: false,
        reason: err instanceof Error ? err.message : 'openclaw not found or failed to run',
      };
    }
  }

  if (platform === 'hermes') {
    try {
      const output = execFileSync('hermes', ['--version'], {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      // output is typically "Hermes Agent vX.Y.Z (...)"
      const versionMatch = output.match(/v(\d+\.\d+\.\d+)/);
      const version = versionMatch ? versionMatch[1] : output.split(/\s+/).at(-1);
      return { available: true, version };
    } catch (err) {
      return {
        available: false,
        reason: err instanceof Error ? err.message : 'hermes not found or failed to run',
      };
    }
  }

  return { available: false, reason: `Unknown platform: ${platform as string}` };
}

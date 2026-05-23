import { execFileSync } from 'node:child_process';

import { getHermesPort } from './heteroTask';

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
    const port = getHermesPort();
    try {
      const res = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        let version: string | undefined;
        try {
          const body = (await res.json()) as { version?: string };
          version = body.version;
        } catch {
          /* ignore parse errors */
        }
        return { available: true, version };
      }
      return { available: false, reason: `Hermes gateway returned HTTP ${res.status}` };
    } catch (err) {
      return {
        available: false,
        reason: err instanceof Error ? err.message : `Hermes gateway not reachable on port ${port}`,
      };
    }
  }

  return { available: false, reason: `Unknown platform: ${platform as string}` };
}

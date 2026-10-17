import os from 'node:os';
import path from 'node:path';

import { COMPUTER_USE_IDENTIFIER } from '@lobechat/device-control/computer-use';
import type { DeviceSystemInfo } from '@lobechat/device-gateway-client';
import { resolveHeteroSpawnCommand } from '@lobechat/heterogeneous-agents/resolveCliCommand';
import type { RuntimeProbeCache } from '@lobechat/heterogeneous-agents/runtimeProbeCache';
import { CodexAppServerClient } from '@lobechat/heterogeneous-agents/spawn';
import { getShellInfo } from '@lobechat/local-file-shell';

import { CLI_CONFIG_DIR_NAME } from '../constants/identity';
import { cliVersion } from '../pkg';
import type { ComputerUseDevice } from '../tools/computerUse';

/**
 * Checks the currently resolved Codex binary without creating a conversation.
 *
 * Use when:
 * - Reporting native runtime support to a connected gateway.
 * Expects:
 * - The same binary resolution and PATH as ordinary CLI dispatch.
 * Returns:
 * - False for missing, incompatible, malformed, or stalled native handshakes.
 *
 * Call stack:
 * registerConnectCommand -> connect capabilities
 * bindGatewayClientHandlers
 *   -> {@link collectSystemInfo}
 *     -> {@link supportsNativeCodex}
 *       -> {@link resolveHeteroSpawnCommand}
 *       -> {@link CodexAppServerClient.connect}
 */
async function supportsNativeCodex(): Promise<boolean> {
  let client: CodexAppServerClient | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Device discovery has a 10-second budget. Bound binary resolution and handshake
  // together so a broken installation cannot block unrelated device tools.
  // Cold Codex startup can exceed 3 seconds; reserve 6 seconds below the gateway budget.
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve(false);
    }, 6000);
  });
  const probe = async () => {
    try {
      const resolved = await resolveHeteroSpawnCommand('codex');
      // A late resolver must not create a subprocess after the caller has timed out.
      if (expired) return false;
      client = new CodexAppServerClient({
        clientVersion: cliVersion,
        commandPath: resolved.command,
        cwd: process.cwd(),
        env: { ...process.env, ...(resolved.pathEnv ? { PATH: resolved.pathEnv } : {}) },
      });
      const response = await client.connect();
      return typeof response?.userAgent === 'string' && response.userAgent.length > 0;
    } catch {
      return false;
    }
  };
  try {
    return await Promise.race([probe(), deadline]);
  } finally {
    clearTimeout(timer);
    // The probe owns only its handshake process, never a user's native session.
    client?.close();
  }
}

/** Native agent runtimes the resolved binaries support; one handshake per call. */
export async function probeNativeRuntimes(): Promise<string[]> {
  return (await supportsNativeCodex()) ? ['codex-app-server-v1'] : [];
}

/**
 * The answer to a gateway `system_info_request`: host paths and live native capabilities.
 * `supportedTools` lists the opt-in tools this device can run; the server refuses those
 * tools on a device that does not list them.
 *
 * Use when: a gateway requests this connection's current system information.
 * Expects: local paths and binary resolution belong to this connect process.
 * Returns: system information even when Codex is unavailable.
 *
 * Call stack:
 * bindGatewayClientHandlers -> {@link collectSystemInfo}
 *   -> RuntimeProbeCache.get -> {@link probeNativeRuntimes} -> {@link supportsNativeCodex}
 */
export async function collectSystemInfo(
  nativeRuntimes: RuntimeProbeCache,
  computerUse?: ComputerUseDevice,
): Promise<DeviceSystemInfo> {
  const home = os.homedir();
  const platform = process.platform;
  const videosDir = platform === 'linux' ? 'Videos' : 'Movies';

  return {
    arch: os.arch(),
    // Tell the server-side prompt builder which shell runCommand spawns here.
    defaultShell: (await getShellInfo()).displayName,
    desktopPath: path.join(home, 'Desktop'),
    documentsPath: path.join(home, 'Documents'),
    downloadsPath: path.join(home, 'Downloads'),
    homePath: home,
    musicPath: path.join(home, 'Music'),
    picturesPath: path.join(home, 'Pictures'),
    supportedAgentRuntimes: await nativeRuntimes.get(),
    ...(computerUse && { supportedTools: [COMPUTER_USE_IDENTIFIER] }),
    userDataPath: path.join(home, CLI_CONFIG_DIR_NAME),
    videosPath: path.join(home, videosDir),
    workingDirectory: process.cwd(),
  };
}

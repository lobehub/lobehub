import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import { BROWSER_IDENTIFIER } from '@lobechat/device-control/agent-browser';
import { COMPUTER_USE_IDENTIFIER } from '@lobechat/device-control/computer-use';
import type { DeviceSystemInfo } from '@lobechat/device-gateway-client';
import type { RuntimeProbeCache } from '@lobechat/heterogeneous-agents/runtimeProbeCache';
import { isRecord } from '@lobechat/utils/object';
import { app } from 'electron';

import { resolveCliScript } from '@/modules/cliEmbedding';
import { createLogger } from '@/utils/logger';
import { safeGetPath } from '@/utils/user-path';

const logger = createLogger('services:GatewayConnectionSrv');

/**
 * Reports only native capabilities confirmed by the CLI bundled with this Desktop.
 *
 * Use when: the gateway requests live execution capabilities for a bound device.
 * Expects: the same embedded script and Electron Node runtime used for agent runs.
 * Returns: an empty capability list if the CLI is absent, incompatible, or unresponsive.
 *
 * Call stack:
 * GatewayConnectionService.handleSystemInfoRequest -> {@link collectGatewaySystemInfo}
 *   -> agentRuntimes.get -> {@link collectBundledCliAgentRuntimes} -> resolveCliScript
 *     -> lh connect capabilities -> supportsNativeCodex -> Codex initialize
 */
export const collectBundledCliAgentRuntimes = async (): Promise<string[]> => {
  try {
    // Use the bundled entrypoint rather than a global lh that may lag this build.
    // The CLI bounds its native handshake to 6 seconds; this outer deadline also
    // bounds process startup while staying within the gateway's 10-second budget.
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [resolveCliScript(), 'connect', 'capabilities'],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        maxBuffer: 64 * 1024,
        timeout: 9000,
        windowsHide: true,
      },
    );
    const result: unknown = JSON.parse(stdout);
    if (!isRecord(result) || !Array.isArray(result.supportedAgentRuntimes)) return [];
    return result.supportedAgentRuntimes.includes('codex-app-server-v1')
      ? ['codex-app-server-v1']
      : [];
  } catch (error) {
    logger.debug('Bundled CLI native capability probe unavailable', error);
    return [];
  }
};

/** Host paths, desktop tools, and the cached native runtimes this Desktop reports. */
export const collectGatewaySystemInfo = async (
  agentRuntimes: RuntimeProbeCache,
): Promise<DeviceSystemInfo> => {
  const { getShellInfo } = await import('@lobechat/local-file-shell/shell');
  return {
    supportedTools: [COMPUTER_USE_IDENTIFIER, BROWSER_IDENTIFIER],
    supportedAgentRuntimes: await agentRuntimes.get(),
    arch: os.arch(),
    // Tell the server-side prompt builder which shell runCommand spawns here.
    defaultShell: (await getShellInfo()).displayName,
    desktopPath: app.getPath('desktop'),
    documentsPath: app.getPath('documents'),
    downloadsPath: safeGetPath('downloads'),
    homePath: app.getPath('home'),
    musicPath: safeGetPath('music'),
    picturesPath: safeGetPath('pictures'),
    userDataPath: app.getPath('userData'),
    videosPath: safeGetPath('videos'),
    workingDirectory: process.cwd(),
  };
};

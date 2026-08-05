import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  HETEROGENEOUS_AGENT_CONFIGS,
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS,
  type RemoteHeterogeneousAgentType,
} from '../config';
import { detectHeterogeneousCliCommand } from '../spawn/resolveCliCommand';
import type { HeterogeneousAgentScanMap, HeterogeneousAgentScanStatus } from './types';

/**
 * Host-side scanner behind the `scanHeterogeneousAgents` device tool: probes
 * every known heterogeneous agent type on the current machine in one pass.
 * Runs in Node contexts only (the `lh connect` CLI and Electron main) — like
 * `resolveCliCommand`, it must be imported via its dedicated subpath
 * (`@lobechat/heterogeneous-agents/scanHost`), never from a browser bundle.
 */

const execFileP = promisify(execFile);

const PROBE_TIMEOUT_MS = 5000;

// openclaw prints "openclaw x.y.z"; hermes prints "Hermes Agent vX.Y.Z (...)"
const parsePlatformVersion = (type: RemoteHeterogeneousAgentType, output: string) => {
  if (type === 'hermes') {
    const match = output.match(/v(\d+\.\d+\.\d+)/);
    if (match) return match[1];
  }
  return output.split(/\s+/).at(-1);
};

const probeRemotePlatform = async (
  type: RemoteHeterogeneousAgentType,
): Promise<HeterogeneousAgentScanStatus> => {
  try {
    const { stdout } = await execFileP(type, ['--version'], {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    return { available: true, version: parsePlatformVersion(type, stdout.trim()) };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : `${type} not found or failed to run`,
    };
  }
};

export const scanHeterogeneousAgentsOnHost = async (): Promise<HeterogeneousAgentScanMap> => {
  const entries = await Promise.all([
    ...HETEROGENEOUS_AGENT_CONFIGS.map(async (config) => {
      const status = await detectHeterogeneousCliCommand(config.type, config.command);
      return [
        config.type,
        {
          available: status.available,
          version: status.version,
        } satisfies HeterogeneousAgentScanStatus,
      ] as const;
    }),
    ...REMOTE_HETEROGENEOUS_AGENT_CONFIGS.map(async (config) => {
      const status = await probeRemotePlatform(config.type);
      return [config.type, status] as const;
    }),
  ]);

  return Object.fromEntries(entries);
};

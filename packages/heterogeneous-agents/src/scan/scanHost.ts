import { homedir, platform } from 'node:os';
import path from 'node:path';

import type { RemoteHeterogeneousAgentType } from '../config';
import { HETEROGENEOUS_AGENT_CONFIGS, REMOTE_HETEROGENEOUS_AGENT_CONFIGS } from '../config';
import type { CliCommandStatus } from '../spawn/resolveCliCommand';
import { detectHeterogeneousCliCommand, detectValidatedCommand } from '../spawn/resolveCliCommand';
import type { HeterogeneousAgentScanMap, HeterogeneousAgentScanStatus } from './types';

/**
 * Host-side scanner behind the `scanHeterogeneousAgents` device tool: probes
 * every known heterogeneous agent type on the current machine in one pass.
 * Runs in Node contexts only (the `lh connect` CLI and Electron main) — like
 * `resolveCliCommand`, it must be imported via its dedicated subpath
 * (`@lobechat/heterogeneous-agents/scanHost`), never from a browser bundle.
 */

const BARE_VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:[-+][\dA-Za-z.-]+)?$/;

const getRemotePlatformCommandCandidates = (type: RemoteHeterogeneousAgentType): string[] => {
  if (platform() !== 'darwin' && platform() !== 'linux') return [type];

  if (type === 'openclaw') {
    return [
      type,
      path.join(homedir(), '.openclaw', 'bin', 'openclaw'),
      path.join(homedir(), '.local', 'bin', 'openclaw'),
    ];
  }

  return [type, path.join(homedir(), '.local', 'bin', 'hermes')];
};

/**
 * Resolve and validate a notify-based platform executable using the same
 * login-shell PATH and Windows npm-shim handling as the CLI agent resolver.
 * Spawn sites must use the returned absolute path and `resolvedPathEnv` too;
 * otherwise a packaged Electron app can detect a command that it cannot run.
 */
export const resolveRemotePlatformCommand = async (
  type: RemoteHeterogeneousAgentType,
): Promise<CliCommandStatus> => {
  const validation =
    type === 'openclaw'
      ? {
          validateHelpKeywords: ['Usage: openclaw'],
          validateKeywords: ['openclaw'],
          validatePattern: BARE_VERSION_PATTERN,
        }
      : { validateKeywords: ['hermes'] };

  for (const command of getRemotePlatformCommandCandidates(type)) {
    const status = await detectValidatedCommand(command, validation);
    if (status.available) return status;
  }

  return {
    available: false,
    error: `${type} was not found or failed validation`,
  };
};

export const probeRemotePlatform = async (
  type: RemoteHeterogeneousAgentType,
): Promise<HeterogeneousAgentScanStatus> => {
  const status = await resolveRemotePlatformCommand(type);
  return status.available
    ? { available: true, version: status.version }
    : { available: false, reason: status.error };
};

export const scanHeterogeneousAgentsOnHost = async (): Promise<HeterogeneousAgentScanMap> => {
  const entries = await Promise.all([
    ...HETEROGENEOUS_AGENT_CONFIGS.map(async (config) => {
      const status = await detectHeterogeneousCliCommand(config.type, config.defaultCommand);
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

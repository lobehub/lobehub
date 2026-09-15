import { execFile } from 'node:child_process';
import { homedir, platform } from 'node:os';
import path from 'node:path';

import type { RemoteHeterogeneousAgentDescriptor, RemoteHeterogeneousAgentType } from '../config';
import { HETEROGENEOUS_AGENT_CONFIGS, REMOTE_HETEROGENEOUS_AGENT_CONFIGS } from '../config';
import { resolveCliSpawnPlan } from '../spawn/cliSpawn';
import type { CliCommandStatus } from '../spawn/resolveCliCommand';
import {
  detectHeterogeneousCliCommand,
  detectValidatedCommandCandidates,
} from '../spawn/resolveCliCommand';
import type { HeterogeneousAgentScanMap, HeterogeneousAgentScanStatus } from './types';

/**
 * Host-side scanner behind the `scanHeterogeneousAgents` device tool: probes
 * every known heterogeneous agent type on the current machine in one pass.
 * Runs in Node contexts only (the `lh connect` CLI and Electron main) — like
 * `resolveCliCommand`, it must be imported via its dedicated subpath
 * (`@lobechat/heterogeneous-agents/scanHost`), never from a browser bundle.
 */

const getRemotePlatformConfig = (type: string): RemoteHeterogeneousAgentDescriptor | undefined =>
  REMOTE_HETEROGENEOUS_AGENT_CONFIGS.find((config) => config.type === type);

const getRemotePlatformCommandCandidates = (
  config: RemoteHeterogeneousAgentDescriptor,
): string[] => {
  if (platform() !== 'darwin' && platform() !== 'linux') return [config.cli.command];

  return [
    config.cli.command,
    ...(config.cli.wellKnownHomePaths ?? []).map((relativePath) =>
      path.join(homedir(), ...relativePath.split('/')),
    ),
  ];
};

const buildRemotePlatformEnvironment = (
  status: CliCommandStatus,
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => ({
  ...baseEnv,
  ...(status.resolvedPathEnv && { PATH: status.resolvedPathEnv }),
});

const isUnresolvedWindowsShim = (command: string): boolean =>
  platform() === 'win32' && /\.(?:bat|cmd)$/i.test(command);

/**
 * Resolve and validate a notify-based platform executable using the same
 * login-shell PATH and Windows npm-shim handling as the CLI agent resolver.
 * This is the detection/capability boundary; execution sites must use
 * `resolveRemotePlatformRuntime` so the validated path and environment cannot
 * be separated.
 */
export const resolveRemotePlatformCommand = async (type: string): Promise<CliCommandStatus> => {
  const config = getRemotePlatformConfig(type);
  if (!config) return { available: false, error: `Unknown platform: ${type}` };

  const { helpKeywords, keywords, pattern: validationPattern } = config.cli.validation;
  const validation = {
    ...(helpKeywords && { validateHelpKeywords: [...helpKeywords] }),
    ...(keywords && { validateKeywords: [...keywords] }),
    ...(validationPattern && { validatePattern: new RegExp(validationPattern) }),
  };

  const status = await detectValidatedCommandCandidates(
    getRemotePlatformCommandCandidates(config),
    validation,
  );
  if (status.available && status.path) {
    try {
      const spawnPlan = await resolveCliSpawnPlan(
        status.path,
        [],
        buildRemotePlatformEnvironment(status, process.env),
      );
      if (!isUnresolvedWindowsShim(spawnPlan.command)) return status;
    } catch {
      // A command that validates but cannot produce a shell-free spawn plan is
      // not executable by a task. Report it unavailable so scan and execution
      // cannot disagree.
    }
  }

  return {
    available: false,
    error: `${type} was not found or failed validation`,
  };
};

export interface RemotePlatformCommandOutput {
  stderr: string;
  stdout: string;
}

export interface RemotePlatformSpawnPlan {
  args: string[];
  command: string;
  env: NodeJS.ProcessEnv;
}

export type RemotePlatformCommandRuntime =
  | {
      available: false;
      error: string;
    }
  | {
      available: true;
      execute: (
        args: string[],
        options?: { timeout?: number },
      ) => Promise<RemotePlatformCommandOutput>;
      prepareSpawn: (args: string[]) => Promise<RemotePlatformSpawnPlan>;
      version?: string;
    };

const executeSpawnPlan = (
  spawnPlan: RemotePlatformSpawnPlan,
  timeout = 5000,
): Promise<RemotePlatformCommandOutput> =>
  new Promise((resolve, reject) => {
    execFile(
      spawnPlan.command,
      spawnPlan.args,
      {
        encoding: 'utf8',
        env: spawnPlan.env,
        timeout,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({ stderr: stderr.toString(), stdout: stdout.toString() });
      },
    );
  });

/**
 * Resolve one validated platform executable and bind every execution to the
 * exact PATH that validated it. Consumers keep their own task lifecycle, but
 * cannot accidentally fall back to a bare command or skip Windows shim
 * expansion when preparing a child process.
 */
export const resolveRemotePlatformRuntime = async (
  type: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<RemotePlatformCommandRuntime> => {
  const status = await resolveRemotePlatformCommand(type);
  if (!status.available || !status.path) {
    return {
      available: false,
      error: status.error ?? `${type} was not found or failed validation`,
    };
  }

  const validatedPath = status.path;
  const env = buildRemotePlatformEnvironment(status, baseEnv);
  const prepareSpawn = async (args: string[]): Promise<RemotePlatformSpawnPlan> => ({
    ...(await resolveCliSpawnPlan(validatedPath, args, env)),
    env,
  });

  return {
    available: true,
    execute: async (args, options) => executeSpawnPlan(await prepareSpawn(args), options?.timeout),
    prepareSpawn,
    version: status.version,
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

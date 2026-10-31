import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';

import type { LocalHeterogeneousAgentType } from '../config';
import { getHeterogeneousAgentConfig, getHeterogeneousAgentUpdate } from '../config';
import { resolveCliSpawnPlan } from '../spawn/cliSpawn';
import type { CliCommandStatus } from '../spawn/resolveCliCommand';
import { detectHeterogeneousCliCommand } from '../spawn/resolveCliCommand';
import type { HeterogeneousAgentCliUpdateJob } from './types';

/**
 * Host-side remote update of an agent CLI, behind the
 * `startHeterogeneousAgentCliUpdate` / `getHeterogeneousAgentCliUpdate` device
 * RPCs. Node-only, like `scanHost`: import it through its dedicated subpath
 * (`@lobechat/heterogeneous-agents/agentCliUpdate`), never from a browser bundle.
 *
 * An update runs the CLI's own self-updater in the background; the device
 * keeps one job per agent type in memory, which the caller polls.
 */

const UPDATE_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_TAIL_LENGTH = 2000;

/** Install trees a package manager owns; the CLI's own updater cannot replace them. */
const PACKAGE_MANAGER_PATH_MARKERS = ['/Caskroom/', '/Cellar/'];

const isPackageManagerInstall = async (commandPath: string): Promise<boolean> => {
  const resolved = await realpath(commandPath).catch(() => commandPath);
  return PACKAGE_MANAGER_PATH_MARKERS.some((marker) => resolved.includes(marker));
};

/**
 * Whether this host can update the CLI that `status` found in place: the agent
 * declares a self-update command, and no package manager (Homebrew) owns the
 * install.
 */
export const canSelfUpdateAgentCli = async (
  type: string,
  status: CliCommandStatus,
): Promise<boolean> => {
  if (!getHeterogeneousAgentUpdate(type)?.selfUpdateArgs) return false;
  if (!status.available || !status.path) return false;
  return !(await isPackageManagerInstall(status.path));
};

const jobs = new Map<string, HeterogeneousAgentCliUpdateJob>();

const tail = (output: string) => output.trim().slice(-OUTPUT_TAIL_LENGTH);

const runSelfUpdate = (command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', env, timeout: UPDATE_TIMEOUT_MS, windowsHide: true },
      (error, stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        reject(new Error(tail(`${stdout}\n${stderr}`) || error.message));
      },
    );
  });

const runUpdate = async (
  type: LocalHeterogeneousAgentType,
  defaultCommand: string,
  selfUpdateArgs: string[],
) => {
  const before = await detectHeterogeneousCliCommand(type, defaultCommand);
  if (!(await canSelfUpdateAgentCli(type, before)) || !before.path) {
    throw new Error('This CLI cannot be updated in place on this device');
  }
  jobs.set(type, { ...jobs.get(type)!, fromVersion: before.version });

  const env = {
    ...process.env,
    ...(before.resolvedPathEnv && { PATH: before.resolvedPathEnv }),
  };
  const plan = await resolveCliSpawnPlan(before.path, selfUpdateArgs, env);
  await runSelfUpdate(plan.command, plan.args, env);

  const after = await detectHeterogeneousCliCommand(type, defaultCommand);
  return after.version;
};

/** The latest update of `type` on this host, or `null` when none has run. */
export const getAgentCliUpdate = (type: string): HeterogeneousAgentCliUpdateJob | null =>
  jobs.get(type) ?? null;

/**
 * Start updating `type` in the background and return its job. A second call
 * while one runs returns that job instead of starting another.
 */
export const startAgentCliUpdate = (type: string): HeterogeneousAgentCliUpdateJob => {
  const current = jobs.get(type);
  if (current?.status === 'running') return current;

  const config = getHeterogeneousAgentConfig(type);
  const selfUpdateArgs = getHeterogeneousAgentUpdate(type)?.selfUpdateArgs;
  if (!config || !selfUpdateArgs) throw new Error(`${type} does not support remote updates`);

  const job: HeterogeneousAgentCliUpdateJob = {
    agentType: type,
    startedAt: Date.now(),
    status: 'running',
  };
  jobs.set(type, job);

  void runUpdate(config.type, config.defaultCommand, [...selfUpdateArgs]).then(
    (version) => {
      jobs.set(type, { ...jobs.get(type)!, finishedAt: Date.now(), status: 'succeeded', version });
    },
    (error: unknown) => {
      jobs.set(type, {
        ...jobs.get(type)!,
        error: error instanceof Error ? error.message : String(error),
        finishedAt: Date.now(),
        status: 'failed',
      });
    },
  );

  return job;
};

import { readFile } from 'node:fs/promises';

import type { GoalTrajectory } from '../types';
import { FileGoalTraceStore } from './file-store';
import { RemoteGoalTraceStore } from './remote-store';

export interface LoadGoalTrajectoryOptions {
  /** Fetch through `resolveDownloadUrl` when the goal is not on disk. */
  allowDownload?: boolean;
  /**
   * Sign a download URL for a goal id. There is no public fallback: unlike an
   * operation snapshot, whose key can be derived from its id, a goal
   * trajectory is only reachable through the server, which looks the key up on
   * `goal_traces` and signs it for the caller's own scope.
   */
  resolveDownloadUrl?: (goalId: string) => Promise<string | null>;
  /** Root that `.goal-tracing/` resolves against. Defaults to `process.cwd()`. */
  rootDir?: string;
}

const isUrl = (target: string) => target.startsWith('http://') || target.startsWith('https://');

/**
 * Resolve one goal trajectory from a CLI-style target: a `.json` path, an
 * http(s) URL, or a goal id (local store → `_remote/` cache → optional
 * download).
 *
 * The local store already falls through to the in-progress partial, so a goal
 * that is still running resolves without a special flag — for a long-horizon
 * goal that is the normal case, not the exception.
 */
export async function loadGoalTrajectory(
  target: string,
  options: LoadGoalTrajectoryOptions = {},
): Promise<GoalTrajectory | undefined> {
  const { allowDownload = false, resolveDownloadUrl, rootDir } = options;

  if (target.endsWith('.json') && !isUrl(target)) {
    return JSON.parse(await readFile(target, 'utf8')) as GoalTrajectory;
  }

  if (isUrl(target)) {
    const response = await fetch(target);
    if (!response.ok) {
      throw new Error(`Failed to fetch goal trajectory: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as GoalTrajectory;
  }

  const local = await new FileGoalTraceStore(rootDir).get(target);
  if (local) return local;

  const remote = new RemoteGoalTraceStore(rootDir);
  const cached = await remote.getCached(target);
  if (cached) return cached;

  if (!allowDownload) return undefined;

  const signedUrl = await resolveDownloadUrl?.(target);
  return signedUrl ? remote.fetch(signedUrl, target) : undefined;
}

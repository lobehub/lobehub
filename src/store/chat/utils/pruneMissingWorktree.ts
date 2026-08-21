import type { WorkingDirConfig } from '@lobechat/types';

import { applyWorktreeExitToConfig } from '@/helpers/workingDirectoryPath';
import { deviceService } from '@/services/device';

/**
 * Probe results, keyed by `deviceId::path`.
 *
 * A worktree that exists is re-probed rarely (the answer only changes when the
 * user deletes it, and the next run picks that up after the TTL); a worktree
 * that is gone is re-probed on the same cadence so recreating it recovers on
 * its own. Both directions are cached because the probe is a gateway
 * round-trip on the SEND path — paying it once per run would be a visible
 * latency tax on every message of a worktree-bound conversation.
 */
const CACHE_TTL = 60_000;

const probeCache = new Map<string, { at: number; exists: boolean }>();

/** Exposed for tests — module state would otherwise leak between cases. */
export const clearWorktreeProbeCache = () => probeCache.clear();

const directoryExists = async (deviceId: string, path: string): Promise<boolean | undefined> => {
  const key = `${deviceId}::${path}`;
  const cached = probeCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.exists;

  // `null` = the device could not be reached, which is NOT evidence that the
  // directory is gone — an offline laptop would otherwise have every worktree
  // override stripped off its topics. Leave it unverified and unchanged. The
  // try/catch covers a THROWN probe as the same "unverified": this sits on the
  // send path, where a failed lookup must never take the message down with it.
  let result: Awaited<ReturnType<typeof deviceService.statPath>>;
  try {
    result = await deviceService.statPath(deviceId, path);
  } catch {
    return undefined;
  }
  if (!result) return undefined;

  const exists = result.exists && result.isDirectory;
  probeCache.set(key, { at: Date.now(), exists });
  return exists;
};

/**
 * Drop a `git.activeWorktree` override whose directory no longer exists.
 *
 * A worktree recorded on a topic (or on the agent's per-device pick) outlives
 * the directory itself: `git worktree remove`, a cleanup script, or a deleted
 * branch folder leaves the override behind, and every later run still resolves
 * its cwd to that dead path. Tools then fail with a spawn error for a directory
 * the user cannot see anywhere in the UI — the picker deliberately shows the
 * SOURCE repo, so the bar reads "lobehub" while the run executes nowhere. Worse,
 * an agent-level override is inherited by every NEW topic, so each fresh
 * conversation is born broken.
 *
 * Falling back to the source repo is exactly what the stale-snapshot menu's
 * "back to source" action does; the difference is that this runs at the moment
 * of use, where the alternative is a run that cannot execute at all.
 *
 * No probe happens on the common path: a config without a worktree override —
 * or one whose override IS the source path — returns untouched and synchronously.
 */
export const pruneMissingWorktree = async (params: {
  config?: WorkingDirConfig;
  deviceId?: string;
}): Promise<WorkingDirConfig | undefined> => {
  const { config, deviceId } = params;
  const worktree = config?.git?.activeWorktree;
  if (!config || !worktree || !deviceId || worktree === config.path) return config;

  const exists = await directoryExists(deviceId, worktree);
  if (exists !== false) return config;

  // The source repo has to be there to fall back to. When it is gone too the
  // whole binding is dead and there is nothing better to offer than the
  // recorded state — the shell reports the missing directory by name.
  const sourceExists = await directoryExists(deviceId, config.path);
  if (sourceExists === false) return config;

  return applyWorktreeExitToConfig(config, config.path);
};

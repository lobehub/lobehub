import { useCallback, useEffect, useRef, useState } from 'react';

import {
  beginLaunchInStorage,
  type BeginResult,
  clearLaunchInStorage,
  type ExclusiveResult,
  type ExperimentLaunch,
  experimentLaunchKey,
  type ExperimentLaunchScope,
  launchResumeLockName,
  parseExperimentLaunch,
  runExclusiveLaunch,
  type StoredExperimentLaunch,
} from './experimentLaunch';

interface LaunchOptions {
  benchmarkId?: string;
  userId?: string;
  workspaceId: string | null;
}

/**
 * Serialise read-check-write on one record across tabs with the Web Locks API
 * when the browser has it. Without it the compare-before-write in storage is
 * all there is: a smaller window, not an atomic one.
 */
const withScopeLock = async <T>(key: string, task: () => T): Promise<T> => {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return task();
  return locks.request(key, async () => task());
};

const readStored = (key: string): StoredExperimentLaunch | undefined => {
  try {
    return parseExperimentLaunch(localStorage.getItem(key));
  } catch {
    return undefined;
  }
};

/**
 * The launch record of the new-experiment page, kept in this browser per
 * user, workspace and benchmark. `begin` must succeed before any server call
 * is made: a launch that cannot be checkpointed cannot be resumed, so it is
 * not started. Other tabs' changes arrive through the `storage` event.
 */
export const useExperimentLaunch = ({ benchmarkId, userId, workspaceId }: LaunchOptions) => {
  const scope: ExperimentLaunchScope | undefined =
    userId && benchmarkId ? { benchmarkId, userId, workspaceId } : undefined;
  const key = scope ? experimentLaunchKey(scope) : undefined;
  const [state, setState] = useState<{ key: string; launch?: StoredExperimentLaunch }>();

  const reload = useCallback(() => {
    if (!key) return;
    setState({ key, launch: readStored(key) });
  }, [key]);

  useEffect(() => {
    if (!key) return;
    reload();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === key) reload();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, reload]);

  /** Persist a new record; refused when the scope already holds another launch or storage fails. */
  const begin = async (launch: ExperimentLaunch): Promise<BeginResult> => {
    if (!key) return { ok: false, reason: 'storage' };
    const result = await withScopeLock(key, () => beginLaunchInStorage(localStorage, key, launch));
    reload();
    return result;
  };

  /** Remove the record for this experiment only; another launch under the scope is kept. */
  const clear = async (experimentId: string): Promise<boolean> => {
    if (!key) return false;
    const removed = await withScopeLock(key, () =>
      clearLaunchInStorage(localStorage, key, experimentId),
    );
    reload();
    return removed;
  };

  /**
   * Run one resume of a launch at a time: across tabs through a Web Lock on
   * this launch (not the scope lock `begin`/`clear` take, so nothing nests),
   * or a storage lease where the browser has no Web Locks; and within this
   * tab through a ref, so a double click cannot start a second round.
   */
  const inFlight = useRef<string | undefined>(undefined);
  const resume = async <T>(
    experimentId: string,
    task: () => Promise<T>,
  ): Promise<ExclusiveResult<T>> => {
    if (!key || inFlight.current) return { ran: false, reason: 'busy' };
    inFlight.current = experimentId;
    try {
      const lockName = launchResumeLockName(key, experimentId);
      return await runExclusiveLaunch(
        {
          leaseKey: lockName,
          lockName,
          locks: typeof navigator === 'undefined' ? null : (navigator.locks ?? null),
          storage: localStorage,
        },
        task,
      );
    } finally {
      inFlight.current = undefined;
    }
  };

  const current = state && state.key === key ? state : undefined;
  return {
    begin,
    clear,
    launch: current?.launch,
    ready: !!key && !!current,
    reload,
    resume,
  };
};

import {
  clearLaunchInStorage,
  type ExperimentLaunch,
  experimentLaunchKey,
  type ExperimentLaunchScope,
  launchExperiment,
  type LaunchOutcome,
  type LaunchProgress,
  launchResumeLockName,
  type LaunchServices,
  type LaunchStorage,
  parseExperimentLaunch,
  runExclusiveLaunch,
} from './experimentLaunch';

export interface BackgroundLaunch {
  active: boolean;
  error?: string;
  outcome?: LaunchOutcome;
  progress?: LaunchProgress;
  record: ExperimentLaunch;
}
const states = new Map<string, BackgroundLaunch>();
const pending = new Map<string, Promise<LaunchOutcome>>();
const listeners = new Set<() => void>();
export const backgroundLaunchKey = (userId: string, workspaceId: string | null, id: string) =>
  JSON.stringify([userId, workspaceId, id]);
export const getBackgroundLaunch = (key: string) => states.get(key);
export const subscribeBackgroundLaunch = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const publish = (key: string, state: BackgroundLaunch) => {
  states.set(key, state);
  listeners.forEach((listener) => listener());
};

/** The promise belongs to the browser session, never to a mounted route. */
export function startBackgroundLaunch(
  scope: ExperimentLaunchScope,
  record: ExperimentLaunch,
  services: LaunchServices,
  storage: LaunchStorage = localStorage,
  locks = typeof navigator === 'undefined' ? undefined : navigator.locks,
): Promise<LaunchOutcome> {
  const key = backgroundLaunchKey(scope.userId, scope.workspaceId, record.experimentId);
  const existing = pending.get(key);
  if (existing) return existing;
  const storageKey = experimentLaunchKey(scope);
  let state: BackgroundLaunch = { active: true, record };
  const task = Promise.resolve().then(async () => {
    try {
      const lockName = launchResumeLockName(storageKey, record.experimentId);
      const result = await runExclusiveLaunch(
        { leaseKey: lockName, lockName, locks, storage },
        () =>
          launchExperiment(record, services, (progress) => {
            state = { ...state, progress };
            publish(key, state);
          }),
      );
      if (!result.ran) throw new Error('launch_busy');
      const outcome = result.result;
      state = { ...state, outcome };
      if (outcome.complete) {
        clearLaunchInStorage(storage, storageKey, record.experimentId);
        if (typeof window !== 'undefined')
          window.dispatchEvent(new StorageEvent('storage', { key: storageKey }));
      }
      return outcome;
    } catch (error) {
      state = { ...state, error: error instanceof Error ? error.message : String(error) };
      throw error;
    } finally {
      pending.delete(key);
      publish(key, { ...state, active: false });
    }
  });
  pending.set(key, task);
  publish(key, state);
  return task;
}

/** Refresh recovery is explicit; never automatically repeat an uncertain dispatch. */
export function findSavedExperimentLaunch(userId: string, workspaceId: string | null, id: string) {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('lobe-bench:experiment-launch:v1:')) continue;
      const record = parseExperimentLaunch(localStorage.getItem(key));
      if (record?.version !== 2 || record.experimentId !== id) continue;
      if (key === experimentLaunchKey({ benchmarkId: record.benchmarkId, userId, workspaceId }))
        return record;
    }
  } catch {
    /* Storage may be unavailable; the experiment remains readable. */
  }
}

export const isExperimentLaunching = (id: string) =>
  [...states.values()].some((state) => state.record.experimentId === id && state.active);

export function forgetExperimentLaunch(userId: string, workspaceId: string | null, id: string) {
  const key = backgroundLaunchKey(userId, workspaceId, id);
  if (states.get(key)?.active) return;
  const record = states.get(key)?.record ?? findSavedExperimentLaunch(userId, workspaceId, id);
  if (record) {
    const storageKey = experimentLaunchKey({
      benchmarkId: record.benchmarkId,
      userId,
      workspaceId,
    });
    clearLaunchInStorage(localStorage, storageKey, id);
    window.dispatchEvent(new StorageEvent('storage', { key: storageKey }));
  }
  states.delete(key);
  listeners.forEach((listener) => listener());
}

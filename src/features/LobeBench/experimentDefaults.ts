/**
 * What a new experiment starts with, per person. The built-in benchmark's own
 * defaults apply to everyone; a person's choices here lay over them and live
 * in this browser only (a convenience, like a remembered filter).
 */
export interface ExperimentDefaults {
  k?: number;
  maxSteps?: number;
  timeoutMinutes?: number;
}

const storageKey = (benchmarkId: string) => `lobe-bench:experiment-defaults:${benchmarkId}`;

export const readExperimentDefaults = (benchmarkId?: string): ExperimentDefaults | undefined => {
  if (!benchmarkId) return undefined;
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(benchmarkId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as ExperimentDefaults;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const writeExperimentDefaults = (benchmarkId: string, defaults: ExperimentDefaults) => {
  try {
    globalThis.localStorage?.setItem(storageKey(benchmarkId), JSON.stringify(defaults));
  } catch {
    /* storage unavailable: the form still works for this visit */
  }
};

export const clearExperimentDefaults = (benchmarkId: string) => {
  try {
    globalThis.localStorage?.removeItem(storageKey(benchmarkId));
  } catch {
    /* nothing stored */
  }
};

import type { CheckOutcome, DoctorCheck, DoctorContext, DoctorOptions } from './types';

/** Minimal context for exercising a single check in isolation. */
export function makeContext(options: Partial<DoctorOptions> = {}): DoctorContext {
  const cache = new Map<string, Promise<unknown>>();

  return {
    options: {
      deep: false,
      fix: false,
      offline: false,
      profile: 'all',
      strict: false,
      timeoutMs: 1000,
      ...options,
    },
    probe: <T>(key: string, load: () => Promise<T>): Promise<T> => {
      const existing = cache.get(key);
      if (existing) return existing as Promise<T>;
      const started = load();
      cache.set(key, started);
      return started;
    },
    result: () => undefined,
  };
}

export function runCheck(
  checks: readonly DoctorCheck[],
  id: string,
  ctx: DoctorContext = makeContext(),
): Promise<CheckOutcome> {
  const check = checks.find((candidate) => candidate.id === id);
  if (!check) throw new Error(`No such check: ${id}`);
  return Promise.resolve(check.run(ctx));
}

export function findCheck(checks: readonly DoctorCheck[], id: string): DoctorCheck {
  const check = checks.find((candidate) => candidate.id === id);
  if (!check) throw new Error(`No such check: ${id}`);
  return check;
}

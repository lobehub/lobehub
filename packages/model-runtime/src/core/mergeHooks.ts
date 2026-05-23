import type { ModelRuntimeHooks } from './ModelRuntime';

/**
 * Merge two `ModelRuntimeHooks` instances, chaining handlers that share a key
 * so both fire in `a → b` order. Designed for composing layered hooks at the
 * `ModelRuntime` construction site (e.g. billing hooks + tracing hooks).
 *
 * - Returns `undefined` only when both inputs are empty.
 * - Chained hooks run sequentially (`a` first, then `b`); the second hook only
 *   runs if the first resolves. Place load-bearing hooks (the ones whose
 *   failure should abort the call) in `a`.
 */
export const mergeModelRuntimeHooks = (
  a?: ModelRuntimeHooks,
  b?: ModelRuntimeHooks,
): ModelRuntimeHooks | undefined => {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;

  const merged: ModelRuntimeHooks = { ...a };

  for (const key of Object.keys(b) as (keyof ModelRuntimeHooks)[]) {
    const existing = merged[key];
    const next = b[key];
    if (!existing) {
      (merged[key] as unknown) = next;
      continue;
    }
    (merged[key] as unknown) = async (...args: unknown[]) => {
      await (existing as (...args: unknown[]) => Promise<unknown>)(...args);
      await (next as (...args: unknown[]) => Promise<unknown>)(...args);
    };
  }

  return merged;
};

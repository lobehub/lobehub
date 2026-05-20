import { type StoreApi } from 'zustand';
import { createStoreUpdater as upstream } from 'zustand-utils';

/**
 * Local wrapper around `zustand-utils`'s `createStoreUpdater`.
 *
 * The upstream signature types the `value` argument as exactly `T[Key]`, so
 * passing `string | undefined` to a `string`-typed key fails the TS check —
 * even though the upstream implementation already guards with
 * `typeof value !== 'undefined'` and skips the `setState` call in that case.
 *
 * This wrapper loosens the value type to `T[Key] | null | undefined`, which
 * matches the runtime behavior and lets callers feed optional sources (URL
 * params, selectors that may return undefined, etc.) directly without a
 * lossy `?? ''` fallback that would accidentally write a sentinel into the
 * store.
 */
type LooseStoreUpdater<T> = <Key extends keyof T>(
  key: Key,
  value: T[Key] | null | undefined,
  deps?: any[],
  setStateFn?: StoreApi<T>['setState'],
) => void;

type StoreApiLike<T> = {
  [K in keyof StoreApi<T>]: StoreApi<T>[K];
};

export const createStoreUpdater = <T>(storeApi: StoreApiLike<T>): LooseStoreUpdater<T> =>
  upstream(storeApi) as unknown as LooseStoreUpdater<T>;

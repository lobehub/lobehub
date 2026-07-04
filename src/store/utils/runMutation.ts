import { applyPatches, type Draft, type Patch, produceWithPatches } from 'immer';

import { type StoreSetter } from '@/store/types';
import { type SaveStatus } from '@/types/saveState';

export interface RunMutationConfig<TStore extends object, T> {
  /** The server write. Its resolved value is returned by `runMutation`. */
  mutate: () => Promise<T>;
  /** Debug label for the devtools action names (`<name>/optimistic`, `<name>/rollback`). */
  name?: string;
  /**
   * Surface the failure — typically `saveToast(err, { retry })`. Runs after
   * rollback and is awaited before rethrow, so a refetch-style rollback
   * (`await refreshDetail()`) completes before the caller sees the error.
   */
  onError?: (error: unknown) => void | Promise<void>;
  /**
   * Optimistic update recipe, applied synchronously before `mutate` via immer.
   * `runMutation` records the inverse patches and, on failure, restores exactly
   * the keys this recipe touched — concurrent unrelated updates are preserved.
   */
  optimistic?: (draft: Draft<TStore>) => void;
  /** Rethrow after rollback + `onError` so explicit-submit callers can react. @default true */
  rethrow?: boolean;
  /**
   * Reflect the save lifecycle in the store's own save-state field, whatever its
   * shape (`taskSaveStatus`, `saveStateMap[id]`, …). Called with `'saving'`
   * before the write and `'saved'` / `'failed'` after. This is the enforced
   * invariant: a failed write can never be silently left looking idle.
   */
  setStatus?: (status: SaveStatus) => void;
}

/**
 * Function-style write-mutation helper for zustand class actions — the write-side
 * counterpart to the read-side `AsyncBoundary`. It wraps the recurring
 * saving → optimistic → mutate → (saved | rollback + failed + toast) dance so no
 * action can forget the failure branch, which is the exact bug (`catch → 'idle'`,
 * a lost edit rendering as a clean state) the LOBE-11078 audit found duplicated
 * across the write surfaces.
 *
 * Kept deliberately lightweight vs. the queued `OptimisticEngine` — no cross-action
 * queue or conflict detection, just per-action optimistic + precise patch rollback.
 *
 * @example
 * updateTask = (id, value) =>
 *   runMutation(this.#set, this.#get, {
 *     name: 'updateTask',
 *     setStatus: (s) => this.#set({ taskSaveStatus: s }, false, `updateTask/${s}`),
 *     optimistic: (draft) => {
 *       draft.taskDetailMap[id] = { ...draft.taskDetailMap[id], ...value };
 *     },
 *     mutate: async () => {
 *       await taskService.updateTask(id, value);
 *       await this.#get().refreshTaskList();
 *     },
 *     onError: (err) => saveToast(err, { retry: () => this.#get().updateTask(id, value) }),
 *   });
 */
export async function runMutation<TStore extends object, T = void>(
  set: StoreSetter<TStore>,
  get: () => TStore,
  config: RunMutationConfig<TStore, T>,
): Promise<T> {
  const { mutate, name = 'runMutation', onError, optimistic, rethrow = true, setStatus } = config;

  setStatus?.('saving');

  let inversePatches: Patch[] | undefined;
  if (optimistic) {
    const [next, patches, inverse] = produceWithPatches(get(), optimistic);
    if (patches.length > 0) {
      inversePatches = inverse;
      set(next as TStore, false, `${name}/optimistic`);
    }
  }

  try {
    const result = await mutate();
    setStatus?.('saved');
    return result;
  } catch (error) {
    if (inversePatches) {
      set(applyPatches(get(), inversePatches) as TStore, false, `${name}/rollback`);
    }
    setStatus?.('failed');
    await onError?.(error);
    if (rethrow) throw error;
    return undefined as T;
  }
}

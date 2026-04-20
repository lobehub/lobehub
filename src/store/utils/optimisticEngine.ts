import type { Draft, Patch } from 'immer';
import { applyPatches, produceWithPatches } from 'immer';
import type { StoreApi } from 'zustand';

type StoreState = object;
type AnyStore = StoreHandle<StoreState>;
type Recipe<S> = (draft: Draft<S>) => void;
type RemoteFn<T> = () => Promise<T>;

export type OptimisticMutationStatus =
  | 'failed'
  | 'inflight'
  | 'pending'
  | 'rolled-back'
  | 'success';

export type StoreHandle<S extends StoreState = StoreState> = Pick<
  StoreApi<S>,
  'getState' | 'setState'
>;

export interface OptimisticMutationSnapshot {
  actionName?: string;
  affectedPaths: string[];
  id: string;
  maxRetries: number;
  retryCount: number;
  status: OptimisticMutationStatus;
  timestamp: Date;
}

export interface OptimisticEngineOptions {
  maxHistory?: number;
  maxRetries?: number;
  onMutationError?: (snapshot: OptimisticMutationSnapshot, error: unknown) => void;
  onMutationSuccess?: (snapshot: OptimisticMutationSnapshot) => void;
  onQueueChange?: (snapshots: OptimisticMutationSnapshot[]) => void;
}

interface SetOptions {
  flush?: boolean;
}

interface StorePatchEntry {
  inversePatches: Patch[];
  patches: Patch[];
}

interface QueuedMutation {
  actionName?: string;
  affectedPaths: string[];
  id: string;
  maxRetries: number;
  onError?: (error: unknown) => void | Promise<void>;
  onSuccess?: (result: unknown) => void | Promise<void>;
  reject?: (reason?: unknown) => void;
  remoteFn: RemoteFn<unknown>;
  resolve?: (value: unknown) => void;
  retryCount: number;
  status: OptimisticMutationStatus;
  storePatches: Map<AnyStore, StorePatchEntry>;
  timestamp: number;
}

interface Mutation<T = unknown> extends Omit<QueuedMutation, 'onSuccess' | 'remoteFn' | 'resolve'> {
  onSuccess?: (result: T) => void | Promise<void>;
  remoteFn: RemoteFn<T>;
  resolve?: (value: T) => void;
}

interface SetRecord {
  flushed: boolean;
  inversePatches: Patch[];
  patches: Patch[];
  store: AnyStore;
}

function asAnyStore<S extends StoreState>(store: StoreHandle<S>): AnyStore {
  return store as unknown as AnyStore;
}

const storeIdMap = new WeakMap<AnyStore, string>();
let storeIdCounter = 0;
let mutationIdCounter = 0;

function getStoreId(store: AnyStore): string {
  let id = storeIdMap.get(store);
  if (!id) {
    id = `optimistic-store-${++storeIdCounter}`;
    storeIdMap.set(store, id);
  }

  return id;
}

export function extractAffectedPaths(patches: Patch[]): string[] {
  const paths = new Set<string>();

  for (const patch of patches) {
    const entityPath = patch.path.slice(0, Math.min(patch.path.length, 2)).join('.');
    paths.add(entityPath);
  }

  return Array.from(paths);
}

function extractScopedAffectedPaths(store: AnyStore, patches: Patch[]): string[] {
  const storeId = getStoreId(store);
  return extractAffectedPaths(patches).map((path) => `${storeId}:${path}`);
}

export function hasPathConflict(pathsA: string[], pathsB: string[]): boolean {
  for (const pathA of pathsA) {
    for (const pathB of pathsB) {
      if (pathA === pathB || pathA.startsWith(`${pathB}.`) || pathB.startsWith(`${pathA}.`)) {
        return true;
      }
    }
  }

  return false;
}

function toSnapshot(mutation: QueuedMutation): OptimisticMutationSnapshot {
  return {
    actionName: mutation.actionName,
    affectedPaths: mutation.affectedPaths,
    id: mutation.id,
    maxRetries: mutation.maxRetries,
    retryCount: mutation.retryCount,
    status: mutation.status,
    timestamp: new Date(mutation.timestamp),
  };
}

class MutationQueue {
  private history: OptimisticMutationSnapshot[] = [];
  private idleResolvers = new Set<() => void>();
  private inflightIds = new Set<string>();
  private readonly maxHistory: number;
  private readonly options: Required<OptimisticEngineOptions>;
  private queue: QueuedMutation[] = [];

  constructor(options: OptimisticEngineOptions = {}) {
    this.maxHistory = options.maxHistory ?? 20;
    this.options = {
      maxHistory: this.maxHistory,
      maxRetries: options.maxRetries ?? 0,
      onMutationError: options.onMutationError ?? (() => {}),
      onMutationSuccess: options.onMutationSuccess ?? (() => {}),
      onQueueChange: options.onQueueChange ?? (() => {}),
    };
  }

  private addToHistory(snapshot: OptimisticMutationSnapshot) {
    this.history.unshift(snapshot);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(0, this.maxHistory);
    }
  }

  private getInflightMutations(): QueuedMutation[] {
    return this.queue.filter((mutation) => this.inflightIds.has(mutation.id));
  }

  private hasPendingMutations() {
    return this.queue.some(
      (mutation) => mutation.status === 'pending' || mutation.status === 'inflight',
    );
  }

  private hasInflightConflict(candidate: QueuedMutation): boolean {
    for (const inflight of this.getInflightMutations()) {
      if (hasPathConflict(candidate.affectedPaths, inflight.affectedPaths)) {
        return true;
      }
    }

    return false;
  }

  private notify() {
    this.options.onQueueChange([...this.queue.map(toSnapshot), ...this.history]);

    if (!this.hasPendingMutations()) {
      for (const resolve of this.idleResolvers) {
        resolve();
      }
      this.idleResolvers.clear();
    }
  }

  private processNext() {
    const pending = this.queue
      .filter((mutation) => mutation.status === 'pending' && !this.inflightIds.has(mutation.id))
      .sort((a, b) => a.timestamp - b.timestamp);

    for (const mutation of pending) {
      if (this.hasInflightConflict(mutation)) continue;
      void this.executeMutation(mutation);
    }
  }

  private async settleFailure(mutation: QueuedMutation, error: unknown) {
    mutation.status = 'failed';
    this.inflightIds.delete(mutation.id);

    this.rollback(mutation);
    await mutation.onError?.(error);

    const snapshot: OptimisticMutationSnapshot = {
      ...toSnapshot(mutation),
      status: 'rolled-back',
    };

    this.addToHistory(snapshot);
    this.queue = this.queue.filter((item) => item.id !== mutation.id);
    this.notify();
    this.options.onMutationError(snapshot, error);
    mutation.reject?.(error);
    this.processNext();
  }

  enqueue<T>(mutation: Mutation<T>): Promise<T> {
    const { onSuccess, remoteFn, resolve: _resolve, ...rest } = mutation;
    const queuedMutation: QueuedMutation = {
      ...rest,
      onSuccess: onSuccess
        ? async (result) => {
            await onSuccess(result as T);
          }
        : undefined,
      remoteFn: async () => remoteFn(),
    };

    return new Promise<T>((resolve, reject) => {
      queuedMutation.resolve = (value) => resolve(value as T);
      queuedMutation.reject = reject;

      this.queue.push(queuedMutation);
      this.notify();
      this.processNext();
    });
  }

  async flush(): Promise<void> {
    this.processNext();

    if (!this.hasPendingMutations()) return;

    await new Promise<void>((resolve) => {
      this.idleResolvers.add(resolve);
    });
  }

  private async executeMutation(mutation: QueuedMutation): Promise<void> {
    this.inflightIds.add(mutation.id);
    mutation.status = 'inflight';
    this.notify();

    try {
      const result = await mutation.remoteFn();

      await mutation.onSuccess?.(result);

      mutation.status = 'success';
      this.inflightIds.delete(mutation.id);
      this.addToHistory(toSnapshot(mutation));
      this.queue = this.queue.filter((item) => item.id !== mutation.id);
      this.notify();
      this.options.onMutationSuccess(toSnapshot(mutation));
      mutation.resolve?.(result);
      this.processNext();
    } catch (error) {
      mutation.retryCount += 1;

      if (mutation.retryCount <= mutation.maxRetries) {
        mutation.status = 'pending';
        this.inflightIds.delete(mutation.id);
        this.notify();
        this.processNext();
        return;
      }

      await this.settleFailure(mutation, error);
    }
  }

  private rollback(failedMutation: QueuedMutation) {
    const allStores = new Set<AnyStore>();

    for (const store of failedMutation.storePatches.keys()) {
      allStores.add(store);
    }

    const remaining = this.queue
      .filter((mutation) => mutation.id !== failedMutation.id && mutation.status !== 'failed')
      .sort((a, b) => b.timestamp - a.timestamp);

    for (const mutation of remaining) {
      for (const store of mutation.storePatches.keys()) {
        allStores.add(store);
      }
    }

    for (const store of allStores) {
      let nextState = store.getState();

      for (const mutation of remaining) {
        const entry = mutation.storePatches.get(store);
        if (!entry) continue;

        nextState = applyPatches(nextState, entry.inversePatches);
      }

      const failedEntry = failedMutation.storePatches.get(store);
      if (failedEntry) {
        nextState = applyPatches(nextState, failedEntry.inversePatches);
      }

      for (const mutation of [...remaining].reverse()) {
        const entry = mutation.storePatches.get(store);
        if (!entry) continue;

        nextState = applyPatches(nextState, entry.patches);
      }

      store.setState(nextState);
    }
  }
}

class Transaction<D extends StoreState = Record<string, never>> {
  private committed = false;
  private readonly defaultStore: AnyStore | null;
  private mutationFn: RemoteFn<unknown> | null = null;
  private mutationErrorHandler?: (error: unknown) => void | Promise<void>;
  private mutationSuccessHandler?: (result: unknown) => void | Promise<void>;
  private readonly name: string;
  private readonly enqueueFn: <T>(mutation: Mutation<T>) => Promise<T>;
  private readonly maxRetries: number;
  private records: SetRecord[] = [];
  private workingStates = new Map<AnyStore, StoreState>();

  constructor(
    name: string,
    enqueueFn: <T>(mutation: Mutation<T>) => Promise<T>,
    maxRetries: number,
    defaultStore?: StoreHandle<D>,
  ) {
    this.defaultStore = defaultStore ? asAnyStore(defaultStore) : null;
    this.enqueueFn = enqueueFn;
    this.maxRetries = maxRetries;
    this.name = name;
  }

  set(recipe: Recipe<D>): void;
  set<S extends StoreState>(store: StoreHandle<S>, recipe: Recipe<S>, options?: SetOptions): void;
  set<S extends StoreState>(
    storeOrRecipe: StoreHandle<S> | Recipe<D>,
    recipeOrUndefined?: Recipe<S>,
    maybeOptions?: SetOptions,
  ): void {
    let store: AnyStore;
    let recipe: Recipe<StoreState>;
    let options: SetOptions;

    if (typeof storeOrRecipe === 'function') {
      if (!this.defaultStore) {
        throw new Error(`[OptimisticEngine] "${this.name}": no default store set`);
      }

      store = this.defaultStore;
      recipe = storeOrRecipe as unknown as Recipe<StoreState>;
      options = {};
    } else {
      store = asAnyStore(storeOrRecipe);
      recipe = recipeOrUndefined as unknown as Recipe<StoreState>;
      options = maybeOptions ?? {};
    }

    if (this.committed) {
      throw new Error(`[OptimisticEngine] "${this.name}": cannot call set() after commit()`);
    }

    const shouldFlush = options.flush ?? true;
    const baseState = this.workingStates.get(store) ?? store.getState();
    const [nextState, patches, inversePatches] = produceWithPatches(baseState, recipe);

    if (patches.length === 0) return;

    if (shouldFlush) {
      store.setState(nextState);
      this.workingStates.delete(store);
    } else {
      this.workingStates.set(store, nextState);
    }

    this.records.push({
      flushed: shouldFlush,
      inversePatches,
      patches,
      store,
    });
  }

  set mutation(fn: RemoteFn<unknown>) {
    this.mutationFn = fn;
  }

  set onError(handler: (error: unknown) => void | Promise<void>) {
    this.mutationErrorHandler = handler;
  }

  set onSuccess(handler: (result: unknown) => void | Promise<void>) {
    this.mutationSuccessHandler = handler;
  }

  commit<T = unknown>(): Promise<T> {
    if (this.committed) {
      throw new Error(`[OptimisticEngine] "${this.name}": transaction already committed`);
    }

    if (!this.mutationFn) {
      throw new Error(`[OptimisticEngine] "${this.name}": missing remote mutation`);
    }

    this.committed = true;

    for (const record of this.records) {
      if (record.flushed) continue;

      const nextState = applyPatches(record.store.getState(), record.patches);
      record.store.setState(nextState);
      record.flushed = true;
    }

    this.workingStates.clear();

    const storePatches = new Map<AnyStore, StorePatchEntry>();
    for (const record of this.records) {
      const existing = storePatches.get(record.store);
      if (existing) {
        existing.patches.push(...record.patches);
        existing.inversePatches = [...record.inversePatches, ...existing.inversePatches];
      } else {
        storePatches.set(record.store, {
          inversePatches: [...record.inversePatches],
          patches: [...record.patches],
        });
      }
    }

    const affectedPaths = Array.from(storePatches.entries()).flatMap(([store, entry]) =>
      extractScopedAffectedPaths(store, entry.patches),
    );

    return this.enqueueFn<T>({
      actionName: this.name,
      affectedPaths,
      id: `optimistic-mutation-${++mutationIdCounter}-${Date.now()}`,
      maxRetries: this.maxRetries,
      onError: this.mutationErrorHandler,
      onSuccess: this.mutationSuccessHandler as ((result: T) => void | Promise<void>) | undefined,
      remoteFn: this.mutationFn as RemoteFn<T>,
      retryCount: 0,
      status: 'pending',
      storePatches,
      timestamp: Date.now(),
    });
  }
}

export class OptimisticEngine<S extends StoreState = Record<string, never>> {
  private readonly defaultStore?: StoreHandle<S>;
  private readonly maxRetries: number;
  private readonly queue: MutationQueue;

  constructor(defaultStore?: StoreHandle<S>, options?: OptimisticEngineOptions) {
    this.defaultStore = defaultStore;
    this.maxRetries = options?.maxRetries ?? 0;
    this.queue = new MutationQueue(options);
  }

  createTransaction(name: string): Transaction<S> {
    return new Transaction<S>(
      name,
      <T>(mutation: Mutation<T>) => this.queue.enqueue(mutation),
      this.maxRetries,
      this.defaultStore,
    );
  }

  async flush(): Promise<void> {
    await this.queue.flush();
  }
}

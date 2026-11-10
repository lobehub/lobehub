import type { ReplicaResource, ReplicaState } from 'local-replica';
import type { ReplicaLens } from 'local-replica/zustand';

export interface ReplicaDevtoolsEntry {
  keys: () => string[];
  read: (key: string) => unknown;
  remove: (key: string) => boolean;
  resource: ReplicaResource<any, any, any>;
  revalidate: (key?: string) => Promise<unknown>;
  state: () => ReplicaState<unknown> | undefined;
  update: (key: string, data: unknown, options: { persist: boolean }) => void;
}

interface DevtoolsSlice<TData> {
  remove: (key: string) => boolean;
  revalidate: (key?: string) => Promise<unknown>;
  update: (
    key: string,
    apply: (data: TData | undefined) => TData | undefined,
    options?: { persist?: boolean },
  ) => unknown;
}

interface DevtoolsBinding<TStore, TData> {
  get: () => TStore;
  slice: DevtoolsSlice<TData>;
  stateKey: keyof TStore & string;
  view: ReplicaLens<TStore, TData>;
}

const NOTIFY_INTERVAL = 200;

const entries = new Map<string, ReplicaDevtoolsEntry>();
const listeners = new Set<() => void>();
let version = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const flush = () => {
  timer = undefined;
  version += 1;
  for (const listener of listeners) listener();
};

// Replica commits can fire many times per frame while a transcript streams, so
// the inspector is told at most once per interval, and never while it is closed.
export const notifyReplicaDevtools = () => {
  if (listeners.size === 0 || timer) return;
  timer = setTimeout(flush, NOTIFY_INTERVAL);
};

export const subscribeReplicaDevtools = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getReplicaDevtoolsVersion = () => version;

export const listReplicaDevtools = (): ReplicaDevtoolsEntry[] =>
  [...entries.values()].sort((a, b) => a.resource.name.localeCompare(b.resource.name));

// Keyed by namespace (name + version), which storage already requires to be
// unique, so a store rebuilt by HMR or a test replaces its old registration.
export const registerReplicaDevtools = <TStore, TData>(
  resource: ReplicaResource<any, TData, any>,
  { get, slice, stateKey, view }: DevtoolsBinding<TStore, TData>,
) => {
  const state = () => get()[stateKey] as unknown as ReplicaState<unknown> | undefined;

  entries.set(resource.namespace, {
    keys: () => [
      ...new Set([...Object.keys(state()?.entries ?? {}), ...(view.keys?.(get()) ?? [])]),
    ],
    read: (key) => view.get(get(), key),
    remove: (key) => slice.remove(key),
    resource,
    revalidate: (key) => slice.revalidate(key),
    state,
    update: (key, data, { persist }) => {
      slice.update(key, () => data as TData, { persist });
    },
  });
  notifyReplicaDevtools();
};

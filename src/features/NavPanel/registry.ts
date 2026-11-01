import { type ReactNode } from 'react';

export type NavPanelOwner = symbol;

export interface NavPanelRegistryEntry {
  node: ReactNode;
  owner: NavPanelOwner;
}

export type NavPanelRegistrySnapshot = ReadonlyMap<string, NavPanelRegistryEntry>;

let snapshot: NavPanelRegistrySnapshot = new Map();
const listeners = new Set<() => void>();

const publish = (nextSnapshot: Map<string, NavPanelRegistryEntry>) => {
  snapshot = nextSnapshot;
  listeners.forEach((listener) => listener());
};

export const subscribeNavPanelRegistry = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getNavPanelRegistrySnapshot = (): NavPanelRegistrySnapshot => snapshot;

export const registerNavPanelContent = (key: string, owner: NavPanelOwner, node: ReactNode) => {
  const current = snapshot.get(key);
  if (current?.owner === owner && current.node === node) return;

  const nextSnapshot = new Map(snapshot);
  nextSnapshot.set(key, { node, owner });
  publish(nextSnapshot);
};

export const unregisterNavPanelContent = (key: string, owner: NavPanelOwner) => {
  if (snapshot.get(key)?.owner !== owner) return;

  const nextSnapshot = new Map(snapshot);
  nextSnapshot.delete(key);
  publish(nextSnapshot);
};

export const clearNavPanelRegistry = () => {
  if (snapshot.size === 0) return;
  publish(new Map());
};

import { useSyncExternalStore } from 'react';

const ACTIVE_WORKSPACE_STORAGE_KEY = 'lobehub:active-workspace-id';

interface WorkspaceSnapshot {
  id: string | null;
  slug: string | null;
}

let snapshot: WorkspaceSnapshot = { id: null, slug: null };
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const persist = (id: string | null) => {
  if (typeof window === 'undefined') return;
  if (id) localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, id);
  else localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
};

export const hydrateActiveWorkspaceId = (): string | null => {
  if (snapshot.id) return snapshot.id;
  if (typeof window === 'undefined') return null;

  const id = localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  if (id) snapshot = { id, slug: null };

  return id;
};

export const getWorkspaceSnapshot = () => snapshot;

export const setActiveWorkspaceSnapshot = (next: WorkspaceSnapshot) => {
  if (snapshot.id === next.id && snapshot.slug === next.slug) return;

  snapshot = next;
  persist(next.id);
  emit();
};

export const subscribeWorkspaceSnapshot = (listener: () => void) => {
  listeners.add(listener);

  return () => listeners.delete(listener);
};

export const useWorkspaceSnapshot = () =>
  useSyncExternalStore(subscribeWorkspaceSnapshot, getWorkspaceSnapshot, getWorkspaceSnapshot);

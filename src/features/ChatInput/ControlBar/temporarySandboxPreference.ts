import { useSyncExternalStore } from 'react';

export const TEMPORARY_SANDBOX_PREFERENCE_KEY = 'lobechat-sandbox-temporary-agents';

/**
 * Which agents the person moved to the temporary cloud sandbox from the
 * execution-environment menu. A plan with a drive otherwise starts every new
 * conversation on a drive folder; picking "Cloud sandbox" over "Persistent
 * sandbox" is a choice about the agent, so it has to outlive the conversation
 * it was made in. Per member and per device, like the folder a conversation
 * starts in — the agent's shared config is every member's.
 */
type Store = Record<string, true>;

/**
 * Whose choice it is. The browser is shared by whoever signs in on it, and a
 * workspace agent has the same id for every member, so the signed-in user is
 * part of the key; the drive is per account, so a workspace and the personal
 * space are kept apart too.
 */
export interface TemporarySandboxScope {
  userId?: string | null;
  workspaceId?: string | null;
}

const keyOf = ({ userId, workspaceId }: TemporarySandboxScope, agentId: string) =>
  `${userId || 'anonymous'}:${workspaceId || 'personal'}:${agentId}`;

const listeners = new Set<() => void>();

const readStore = (): Store => {
  try {
    const raw = localStorage.getItem(TEMPORARY_SANDBOX_PREFERENCE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeStore = (store: Store) => {
  try {
    localStorage.setItem(TEMPORARY_SANDBOX_PREFERENCE_KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable (private mode, quota): new conversations start on the
    // plan's default, as they did before anything was remembered.
  }
  for (const listener of listeners) listener();
};

// Another tab writing the same key only reaches this one through the browser's
// `storage` event; without it, a tab left open keeps seeding the old choice.
const onStorage = (event: StorageEvent) => {
  if (event.key !== null && event.key !== TEMPORARY_SANDBOX_PREFERENCE_KEY) return;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  if (listeners.size === 0 && typeof window !== 'undefined')
    window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined')
      window.removeEventListener('storage', onStorage);
  };
};

/** Whether this agent's new conversations start in a temporary sandbox. */
export const prefersTemporarySandbox = (scope: TemporarySandboxScope, agentId: string): boolean =>
  readStore()[keyOf(scope, agentId)] === true;

/** Remember the execution-environment pick: temporary (`true`) or persistent (`false`). */
export const setPrefersTemporarySandbox = (
  scope: TemporarySandboxScope,
  agentId: string,
  temporary: boolean,
): void => {
  const store = readStore();
  const key = keyOf(scope, agentId);
  if (temporary === (store[key] === true)) return;

  if (temporary) store[key] = true;
  else delete store[key];
  writeStore(store);
};

/** The same answer, re-rendering whichever component reads it when any other one writes it. */
export const usePrefersTemporarySandbox = (
  scope: TemporarySandboxScope,
  agentId: string,
): boolean =>
  useSyncExternalStore(
    subscribe,
    () => prefersTemporarySandbox(scope, agentId),
    () => false,
  );

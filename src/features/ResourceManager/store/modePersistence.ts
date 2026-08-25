import type { ResourceListVisibilityFilter } from './initialState';

const KEY_PREFIX = 'lobehub:resource-mode:';
const VALID_MODES: readonly ResourceListVisibilityFilter[] = ['private', 'workspace'];

const isBrowser = () => typeof window !== 'undefined' && !!window.localStorage;

const storageKey = (workspaceId: string) => `${KEY_PREFIX}${workspaceId}`;

/**
 * Read the persisted mode for a workspace. Returns `undefined` when there is
 * no record, when the record is corrupt, or when localStorage is unavailable
 * (SSR, private mode with storage disabled). Callers fall back to the
 * `initialState` default.
 */
export const readPersistedResourceMode = (
  workspaceId: string | undefined,
): ResourceListVisibilityFilter | undefined => {
  if (!workspaceId || !isBrowser()) return undefined;

  try {
    const raw = window.localStorage.getItem(storageKey(workspaceId));
    if (raw && (VALID_MODES as readonly string[]).includes(raw)) {
      return raw as ResourceListVisibilityFilter;
    }
  } catch {
    /* localStorage may throw in restricted contexts — swallow and fall back */
  }

  return undefined;
};

/**
 * Persist the mode for a workspace. No-op in personal mode (no workspaceId)
 * and when storage is unavailable — the toggle itself is hidden in personal
 * mode so nothing calls this with an empty workspaceId in practice, but the
 * guard keeps the helper safe to call from anywhere.
 */
export const writePersistedResourceMode = (
  workspaceId: string | undefined,
  mode: ResourceListVisibilityFilter,
): void => {
  if (!workspaceId || !isBrowser()) return;

  try {
    window.localStorage.setItem(storageKey(workspaceId), mode);
  } catch {
    /* full storage / restricted context — best-effort only */
  }
};

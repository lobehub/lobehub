import { defineReplica } from '@/libs/replica';

import type { SaveState } from './initialState';

export interface GroupProfileSaveParams {
  tabId: string;
}

/**
 * The save status of one profile tab (`saveStateMap[tabId]`).
 *
 * Keyed by the tab id — `'group'` for the group editor, an agent id for each
 * member editor — so the concurrent editors each keep their own entry, and
 * partitioned by identity scope so an account / workspace switch never paints
 * another identity's save status.
 *
 * Memory-only: `idle` / `saving` / `saved` plus `lastUpdatedTime` is transient
 * editor UI state produced by the debounced save cycle (there is no GET over a
 * stable key), so it must never be written to, or hydrated from, storage.
 */
export const groupProfileSaveResource = defineReplica<GroupProfileSaveParams, SaveState>({
  key: ({ tabId }) => tabId,
  name: 'groupProfileSave',
  storage: 'memory',
  version: 1,
});

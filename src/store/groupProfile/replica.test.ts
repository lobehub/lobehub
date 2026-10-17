/**
 * The group-profile save status is a replica: `saveStateMap` is its view,
 * `saveStateMapReplica` its bookkeeping. It is memory-only — the status is
 * transient editor UI state, never written to or hydrated from storage — and a
 * write under a new identity scope drops the previous identity's entries
 * instead of letting them bleed across users / workspaces.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, createReplicaState } from '@/libs/replica';

import { useGroupProfileStore } from './index';
import { groupProfileSaveResource } from './projection';
import { selectors } from './selectors';

const GROUP = 'group';
const AGENT = 'agent-1';

const saveState = (tabId: string) => useGroupProfileStore.getState().saveStateMap[tabId];
const entry = (tabId: string) => useGroupProfileStore.getState().saveStateMapReplica.entries[tabId];

let scope = '';
const useScope = (next: string) => {
  scope = next;
  vi.spyOn(cacheScope, 'get').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'use').mockImplementation(() => scope);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
};

describe('groupProfile replica', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useScope('u1:personal');
    useGroupProfileStore.setState(
      {
        activeTabId: GROUP,
        editor: undefined,
        editorState: undefined,
        saveStateMap: {},
        saveStateMapReplica: createReplicaState(),
      },
      false,
    );
  });

  it('is a memory-only resource (save status is transient UI state)', () => {
    expect(groupProfileSaveResource.persisted).toBe(false);
    expect(groupProfileSaveResource.storage).toBeUndefined();
  });

  it('writes the save status through the engine and keeps the bookkeeping in step', () => {
    useGroupProfileStore.getState().updateSaveStatus(GROUP, 'saving');

    expect(saveState(GROUP)?.saveStatus).toBe('saving');
    expect(saveState(GROUP)?.lastUpdatedTime).toBeNull();
    // The view is backed by the replica engine (a local write, not a fetch).
    expect(entry(GROUP)?.source).toBe('local');
    expect(useGroupProfileStore.getState().saveStateMapReplica.scope).toBe('u1:personal');
    // Selectors keep reading the same view location.
    expect(selectors.getSaveState(GROUP)(useGroupProfileStore.getState()).saveStatus).toBe(
      'saving',
    );
  });

  it('stamps the save time on `saved` and keys the view per tab', () => {
    const before = Date.now();
    useGroupProfileStore.getState().updateSaveStatus(GROUP, 'saved');
    useGroupProfileStore.getState().updateSaveStatus(AGENT, 'saving');

    expect(saveState(GROUP)?.saveStatus).toBe('saved');
    expect(saveState(GROUP)?.lastUpdatedTime).toBeInstanceOf(Date);
    expect((saveState(GROUP)?.lastUpdatedTime as Date).getTime()).toBeGreaterThanOrEqual(before);

    // A second tab (a member editor) keeps its own entry.
    expect(saveState(AGENT)?.saveStatus).toBe('saving');
    expect(saveState(AGENT)?.lastUpdatedTime).toBeNull();
  });

  it('drops the previous identity’s save states when the scope switches', () => {
    useGroupProfileStore.getState().updateSaveStatus(GROUP, 'saved');
    expect(saveState(GROUP)?.saveStatus).toBe('saved');

    useScope('u2:personal');
    // Any write under the new identity first drops the old identity's view.
    useGroupProfileStore.getState().updateSaveStatus(AGENT, 'saving');

    expect(saveState(GROUP)).toBeUndefined();
    expect(saveState(AGENT)?.saveStatus).toBe('saving');
    expect(useGroupProfileStore.getState().saveStateMapReplica.scope).toBe('u2:personal');
  });

  it('clearProfileState clears the view and the replica bookkeeping together', () => {
    useGroupProfileStore.getState().updateSaveStatus(GROUP, 'saved');

    useGroupProfileStore.getState().clearProfileState();

    expect(useGroupProfileStore.getState().saveStateMap).toEqual({});
    expect(useGroupProfileStore.getState().saveStateMapReplica.entries).toEqual({});
    expect(useGroupProfileStore.getState().activeTabId).toBe(GROUP);
    expect(useGroupProfileStore.getState().editor).toBeUndefined();
  });
});

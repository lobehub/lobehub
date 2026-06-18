import { describe, expect, it } from 'vitest';

import { createStore } from '.';

describe('PageEditorStore - rightPanelMode', () => {
  it('should default to copilot mode', () => {
    const store = createStore();

    expect(store.getState().rightPanelMode).toBe('copilot');
  });

  it('should switch to history mode', () => {
    const store = createStore();

    store.getState().setRightPanelMode('history');

    expect(store.getState().rightPanelMode).toBe('history');
  });
});

describe('PageEditorStore - setLockState', () => {
  it('records the holder owner session alongside the holder id', () => {
    const store = createStore();

    store.getState().setLockState('user-1', null, 'page-owner-1');

    expect(store.getState().lockHolderId).toBe('user-1');
    expect(store.getState().lockHolderOwnerId).toBe('page-owner-1');
  });

  it('clears the holder owner when the lock is released', () => {
    const store = createStore();
    store.getState().setLockState('user-1', null, 'page-owner-1');

    store.getState().setLockState(null);

    expect(store.getState().lockHolderId).toBeNull();
    expect(store.getState().lockHolderOwnerId).toBeNull();
  });
});

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

describe('PageEditorStore - metaReadOnly', () => {
  it('ignores setTitle when meta is read-only (manual UI, AI, or extraction)', () => {
    const store = createStore({ metaReadOnly: true, title: 'Skill name' });

    store.getState().setTitle('SKILL.md');

    // title unchanged and the doc never gets marked dirty → no autosave fires
    expect(store.getState().title).toBe('Skill name');
    expect(store.getState().isMetaDirty).toBeFalsy();
  });

  it('ignores setEmoji when meta is read-only', () => {
    const store = createStore({ emoji: '🧩', metaReadOnly: true });

    store.getState().setEmoji('📄');

    expect(store.getState().emoji).toBe('🧩');
    expect(store.getState().isMetaDirty).toBeFalsy();
  });

  it('does not persist meta for a read-only doc even if marked dirty out-of-band', async () => {
    const store = createStore({
      documentId: 'docs_1',
      isMetaDirty: true,
      metaReadOnly: true,
      title: 'SKILL.md',
    });

    await store.getState().performMetaSave();

    // bails before flipping to 'saving' → never reaches the DocumentService write
    expect(store.getState().metaSaveStatus).toBe('idle');
  });

  it('still allows setTitle when meta is editable', () => {
    const store = createStore({ title: 'Old' });

    store.getState().setTitle('New');

    expect(store.getState().title).toBe('New');
    expect(store.getState().isMetaDirty).toBe(true);
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

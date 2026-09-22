import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '.';

const performSaveMock = vi.fn();

vi.mock('@/store/document', () => ({
  useDocumentStore: {
    getState: () => ({ performSave: performSaveMock }),
  },
}));

describe('PageEditorStore - meta save vs in-flight typing', () => {
  beforeEach(() => {
    performSaveMock.mockReset();
    vi.useFakeTimers();
  });

  it('keeps characters typed while a title save is in flight and re-queues a save', async () => {
    let resolveSave!: () => void;
    performSaveMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const onTitleChange = vi.fn();
    const store = createStore({ documentId: 'docs_1', onTitleChange, title: '' });

    store.getState().setTitle('abc');
    const saving = store.getState().performMetaSave();
    expect(store.getState().metaSaveStatus).toBe('saving');

    // user keeps typing while the request is in flight
    store.getState().setTitle('abcdef');

    resolveSave();
    await saving;

    expect(store.getState().title).toBe('abcdef');
    expect(store.getState().lastSavedTitle).toBe('abc');
    expect(store.getState().isMetaDirty).toBe(true);
    expect(onTitleChange).toHaveBeenCalledWith('abc');

    // the trailing edit is persisted by the re-queued debounce
    performSaveMock.mockResolvedValue(undefined);
    await vi.runAllTimersAsync();

    expect(performSaveMock).toHaveBeenLastCalledWith(
      'docs_1',
      { emoji: undefined, title: 'abcdef' },
      { saveSource: 'autosave' },
    );
    expect(store.getState().isMetaDirty).toBe(false);
    expect(store.getState().lastSavedTitle).toBe('abcdef');
  });

  it('marks meta clean after a save when nothing changed meanwhile', async () => {
    performSaveMock.mockResolvedValue(undefined);
    const store = createStore({ documentId: 'docs_1', title: '' });

    store.getState().setTitle('abc');
    await store.getState().performMetaSave();

    expect(store.getState().isMetaDirty).toBe(false);
    expect(store.getState().metaSaveStatus).toBe('saved');
  });
});

describe('PageEditorStore - syncMeta', () => {
  it('adopts external title/emoji when the local meta is clean', () => {
    const store = createStore({ title: 'Old' });
    store.getState().initMeta('Old', undefined);

    store.getState().syncMeta('Renamed from sidebar', '📄');

    expect(store.getState().title).toBe('Renamed from sidebar');
    expect(store.getState().emoji).toBe('📄');
    expect(store.getState().lastSavedTitle).toBe('Renamed from sidebar');
    expect(store.getState().lastSavedEmoji).toBe('📄');
    expect(store.getState().isMetaDirty).toBe(false);
  });

  it('ignores external title while the user has unsaved local edits', () => {
    const store = createStore({ title: 'Old' });
    store.getState().initMeta('Old', undefined);
    store.getState().setTitle('Old typing');

    // list refresh echoes the previously saved value
    store.getState().syncMeta('Old', undefined);

    expect(store.getState().title).toBe('Old typing');
    expect(store.getState().isMetaDirty).toBe(true);
  });

  it('ignores external title while a meta save is in flight', () => {
    const store = createStore({ title: 'Old' });
    store.getState().initMeta('Old', undefined);
    store.getState().setTitle('abc');
    // simulate save in flight with the dirty flag already consumed
    store.setState({ isMetaDirty: false, metaSaveStatus: 'saving' });

    store.getState().syncMeta('Old', undefined);

    expect(store.getState().title).toBe('abc');
  });

  it('is a no-op when the external value matches the last saved value', () => {
    const store = createStore({ title: 'Same' });
    store.getState().initMeta('Same', '📄');
    const before = store.getState();

    store.getState().syncMeta('Same', '📄');

    expect(store.getState().title).toBe(before.title);
    expect(store.getState().emoji).toBe(before.emoji);
  });
});

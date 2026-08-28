import type { IEditor } from '@lobehub/editor';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDraft, saveDraft } from '../draftStorage';
import { createStore, Provider } from '../store';
import { useChatInputDraft } from './useChatInputDraft';

const createFakeEditor = () => {
  let json: Record<string, unknown> | undefined;

  return {
    cleanDocument: vi.fn(() => {
      json = undefined;
    }),
    focus: vi.fn(),
    getDocument: vi.fn((type: string) =>
      type === 'markdown' ? ((json?.text as string) ?? '') : json,
    ),
    get isEmpty() {
      return !json?.text;
    },
    setDocument: vi.fn((_type: string, content: Record<string, unknown>) => {
      json = content;
    }),
  } as unknown as IEditor;
};

describe('useChatInputDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('flushes the pending debounced draft save on unmount', () => {
    const draftJson = { root: { children: [{ text: 'latest edit' }] } };
    const editor = {
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'latest edit' : draftJson)),
    } as unknown as IEditor;
    const store = createStore({ draftKey: 'main_agent_topic', editor });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => store}>{children}</Provider>
    );

    const { result, unmount } = renderHook(() => useChatInputDraft(), { wrapper });

    act(() => {
      result.current.saveDraftDebounced();
    });

    expect(getDraft('main_agent_topic')).toBeUndefined();

    unmount();

    expect(getDraft('main_agent_topic')).toEqual(draftJson);
  });

  it('persists live editor content on unmount when no save is pending yet', () => {
    const editor = createFakeEditor();
    const store = createStore({ draftKey: 'main_agt_a_tpc_1', editor });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => store}>{children}</Provider>
    );

    const { result, unmount } = renderHook(() => useChatInputDraft(), { wrapper });

    act(() => {
      result.current.restoreDraft(editor);
      // the editor's own change notification is debounced, so text typed right
      // before the composer unmounts has not scheduled a save yet
      editor.setDocument('json', { text: 'typed right before leaving' });
    });

    unmount();

    expect(getDraft('main_agt_a_tpc_1')).toEqual({ text: 'typed right before leaving' });
  });

  it('restores input the previous composer instance persisted on unmount', () => {
    const editor = createFakeEditor();
    const store = createStore({ draftKey: 'main_agt_a_tpc_1', editor });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => store}>{children}</Provider>
    );

    const first = renderHook(() => useChatInputDraft(), { wrapper });
    act(() => {
      first.result.current.restoreDraft(editor);
      editor.setDocument('json', { text: 'typed a moment before remount' });
    });
    first.unmount();

    // remounting the composer re-seeds the editor from the empty `content`
    // prop, so the text can only come back through the stored draft
    editor.cleanDocument();

    const second = renderHook(() => useChatInputDraft(), { wrapper });
    act(() => {
      second.result.current.restoreDraft(editor);
    });

    expect(editor.getDocument('markdown')).toBe('typed a moment before remount');
  });

  it('keeps a newer draft when an empty composer flushes a pending save on unmount', () => {
    const draftKey = 'main_agt_a_tpc_shared';
    const emptyEditor = createFakeEditor();
    const writerEditor = createFakeEditor();
    const emptyStore = createStore({ draftKey, editor: emptyEditor });
    const writerStore = createStore({ draftKey, editor: writerEditor });
    const emptyWrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => emptyStore}>{children}</Provider>
    );
    const writerWrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => writerStore}>{children}</Provider>
    );

    const emptyComposer = renderHook(() => useChatInputDraft(), { wrapper: emptyWrapper });
    const writerComposer = renderHook(() => useChatInputDraft(), { wrapper: writerWrapper });

    act(() => {
      emptyComposer.result.current.restoreDraft(emptyEditor);
      writerComposer.result.current.restoreDraft(writerEditor);
      emptyComposer.result.current.saveDraftDebounced();
      writerEditor.setDocument('json', { text: 'draft from the other tab' });
      writerComposer.result.current.saveDraftDebounced();
      writerComposer.result.current.saveDraftDebounced.flush();
    });

    expect(getDraft(draftKey)).toEqual({ text: 'draft from the other tab' });

    emptyComposer.unmount();

    expect(getDraft(draftKey)).toEqual({ text: 'draft from the other tab' });

    writerComposer.unmount();
  });

  it('removes its unchanged draft when flushing a pending clear on unmount', () => {
    const draftKey = 'main_agt_a_tpc_owned';
    const editor = createFakeEditor();
    const store = createStore({ draftKey, editor });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => store}>{children}</Provider>
    );
    saveDraft(draftKey, { text: 'draft to clear' });

    const { result, unmount } = renderHook(() => useChatInputDraft(), { wrapper });

    act(() => {
      result.current.restoreDraft(editor);
      editor.cleanDocument();
      result.current.saveDraftDebounced();
    });

    expect(getDraft(draftKey)).toEqual({ text: 'draft to clear' });

    unmount();

    expect(getDraft(draftKey)).toBeUndefined();
  });

  it('restores a draft when the editor is empty', () => {
    const draftJson = { root: { children: [{ text: 'draft' }] } };
    const setDocument = vi.fn();
    const editor = {
      getDocument: vi.fn(),
      isEmpty: true,
      setDocument,
    } as unknown as IEditor;
    const store = createStore({ draftKey: 'main_agent_topic', editor });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => store}>{children}</Provider>
    );
    saveDraft('main_agent_topic', draftJson);

    const { result } = renderHook(() => useChatInputDraft(), { wrapper });

    act(() => {
      result.current.restoreDraft(editor);
    });

    expect(setDocument).toHaveBeenCalledWith('json', draftJson);
  });

  it('saves the old draft, clears the editor and restores the new draft on draftKey change', () => {
    const oldJson = { root: { children: [{ text: 'old topic draft' }] } };
    const newJson = { root: { children: [{ text: 'new topic draft' }] } };
    let markdown = 'old topic draft';
    let empty = false;
    const editor = {
      cleanDocument: vi.fn(() => {
        markdown = '';
        empty = true;
      }),
      focus: vi.fn(),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? markdown : oldJson)),
      get isEmpty() {
        return empty;
      },
      setDocument: vi.fn(),
    } as unknown as IEditor;
    const store = createStore({ draftKey: 'main_agt_a_tpc_1', editor });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => store}>{children}</Provider>
    );
    saveDraft('main_agt_a_tpc_2', newJson);

    const { result } = renderHook(() => useChatInputDraft(), { wrapper });

    act(() => {
      result.current.saveDraftDebounced();
      store.setState({ draftKey: 'main_agt_a_tpc_2' });
    });

    expect(getDraft('main_agt_a_tpc_1')).toEqual(oldJson);
    expect(editor.cleanDocument).toHaveBeenCalledTimes(1);
    expect(editor.setDocument).toHaveBeenCalledWith('json', newJson);

    act(() => {
      vi.runAllTimers();
    });

    expect(getDraft('main_agt_a_tpc_1')).toEqual(oldJson);
    expect(getDraft('main_agt_a_tpc_2')).toEqual(newJson);
  });

  it('focuses the editor after switching to another draft key', () => {
    const focus = vi.fn();
    const editor = {
      cleanDocument: vi.fn(),
      focus,
      getDocument: vi.fn((type: string) => (type === 'markdown' ? '' : undefined)),
      isEmpty: true,
      setDocument: vi.fn(),
    } as unknown as IEditor;
    const store = createStore({ draftKey: 'main_agt_a_tpc_1', editor });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => store}>{children}</Provider>
    );

    renderHook(() => useChatInputDraft(), { wrapper });

    expect(focus).not.toHaveBeenCalled();

    act(() => {
      store.setState({ draftKey: 'main_agt_a_tpc_2' });
    });

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('does not auto-focus on mobile after switching draft key', () => {
    const focus = vi.fn();
    const editor = {
      cleanDocument: vi.fn(),
      focus,
      getDocument: vi.fn((type: string) => (type === 'markdown' ? '' : undefined)),
      isEmpty: true,
      setDocument: vi.fn(),
    } as unknown as IEditor;
    const store = createStore({ draftKey: 'main_agt_a_tpc_1', editor, mobile: true });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => store}>{children}</Provider>
    );

    renderHook(() => useChatInputDraft(), { wrapper });

    act(() => {
      store.setState({ draftKey: 'main_agt_a_tpc_2' });
    });

    expect(focus).not.toHaveBeenCalled();
  });

  it('removes the old draft when leaving with an emptied editor', () => {
    const editor = createFakeEditor();
    const store = createStore({ draftKey: 'main_agt_a_tpc_1', editor });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => store}>{children}</Provider>
    );
    saveDraft('main_agt_a_tpc_1', { text: 'stale' });

    const { result } = renderHook(() => useChatInputDraft(), { wrapper });

    act(() => {
      result.current.restoreDraft(editor);
      editor.cleanDocument();
    });

    act(() => {
      store.setState({ draftKey: 'main_agt_a_tpc_2' });
    });

    expect(getDraft('main_agt_a_tpc_1')).toBeUndefined();
  });

  it('keeps a draft the editor has not loaded yet when the draft key changes', () => {
    const editor = createFakeEditor();
    const store = createStore({ draftKey: 'main_agt_a_tpc_1', editor });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => store}>{children}</Provider>
    );
    saveDraft('main_agt_a_tpc_1', { text: 'unsent draft' });

    // no restoreDraft: mirrors the window between mount and the restore frame,
    // where the editor is empty simply because nothing loaded it yet
    renderHook(() => useChatInputDraft(), { wrapper });

    act(() => {
      store.setState({ draftKey: 'main_agt_a_tpc_2' });
    });

    expect(getDraft('main_agt_a_tpc_1')).toEqual({ text: 'unsent draft' });
  });

  it('keeps a draft the editor has not loaded yet when the debounced save runs', () => {
    const editor = createFakeEditor();
    const store = createStore({ draftKey: 'main_agt_a_tpc_1', editor });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => store}>{children}</Provider>
    );
    saveDraft('main_agt_a_tpc_1', { text: 'unsent draft' });

    const { result } = renderHook(() => useChatInputDraft(), { wrapper });

    // the editor reports every commit, selection-only ones included, so a save
    // can be scheduled before the restore frame lands
    act(() => {
      result.current.saveDraftDebounced();
      vi.runAllTimers();
    });

    expect(getDraft('main_agt_a_tpc_1')).toEqual({ text: 'unsent draft' });
  });

  it('does not overwrite current editor input when restoring a draft', () => {
    const setDocument = vi.fn();
    const editor = {
      getDocument: vi.fn(),
      isEmpty: false,
      setDocument,
    } as unknown as IEditor;
    const store = createStore({ draftKey: 'main_agent_topic', editor });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => store}>{children}</Provider>
    );
    saveDraft('main_agent_topic', { root: { children: [{ text: 'old draft' }] } });

    const { result } = renderHook(() => useChatInputDraft(), { wrapper });

    act(() => {
      result.current.restoreDraft(editor);
    });

    expect(setDocument).not.toHaveBeenCalled();
  });
});

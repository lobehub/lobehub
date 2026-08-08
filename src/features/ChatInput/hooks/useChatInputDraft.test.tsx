import type { IEditor } from '@lobehub/editor';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDraft, saveDraft } from '../draftStorage';
import { createStore, Provider } from '../store';
import { useChatInputDraft } from './useChatInputDraft';

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
    const editor = {
      cleanDocument: vi.fn(),
      focus: vi.fn(),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? '' : undefined)),
      isEmpty: true,
      setDocument: vi.fn(),
    } as unknown as IEditor;
    const store = createStore({ draftKey: 'main_agt_a_tpc_1', editor });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider createStore={() => store}>{children}</Provider>
    );
    saveDraft('main_agt_a_tpc_1', { root: { children: [{ text: 'stale' }] } });

    renderHook(() => useChatInputDraft(), { wrapper });

    act(() => {
      store.setState({ draftKey: 'main_agt_a_tpc_2' });
    });

    expect(getDraft('main_agt_a_tpc_1')).toBeUndefined();
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

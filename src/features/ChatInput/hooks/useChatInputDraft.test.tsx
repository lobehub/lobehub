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

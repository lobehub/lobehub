import type { IEditor } from '@lobehub/editor';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getInputHistory } from '../inputHistoryStorage';
import { createStore, selectors } from '.';

describe('ChatInput store actions', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('clears the autocomplete breaker when dismissing its error', () => {
    const store = createStore();

    store.getState().pauseInputCompletion({ message: 'InsufficientBudgetForModel' });

    expect(selectors.inputCompletionPaused(store.getState())).toBe(true);

    store.getState().dismissInputCompletionError();

    expect(store.getState().inputCompletionError).toBeUndefined();
    expect(selectors.inputCompletionPaused(store.getState())).toBe(false);
    expect(selectors.inputCompletionErrorVisible(store.getState())).toBeUndefined();
  });

  it('records non-empty sent input in local history before the editor is cleared', () => {
    const editorData = { root: { children: [{ text: 'Hello' }] } };
    const editor = {
      cleanDocument: vi.fn(),
      focus: vi.fn(),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : editorData)),
    };
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend: ({ clearContent }) => {
        clearContent();
      },
    });

    store.getState().handleSendButton();

    expect(getInputHistory()[0]).toMatchObject({
      json: editorData,
      markdown: 'Hello',
    });
  });

  it('does not record history when the input history feature is disabled', () => {
    const editor = {
      cleanDocument: vi.fn(),
      focus: vi.fn(),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : { root: {} })),
    };
    const store = createStore({
      editor: editor as unknown as IEditor,
      feature: { inputCompletion: true, inputHistory: false, mention: true, slash: true },
      onSend: vi.fn(),
    });

    store.getState().handleSendButton();

    expect(getInputHistory()).toEqual([]);
  });

  it('does not record history when no send handler is configured', () => {
    const editor = {
      cleanDocument: vi.fn(),
      focus: vi.fn(),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : { root: {} })),
    };
    const store = createStore({
      editor: editor as unknown as IEditor,
    });

    store.getState().handleSendButton();

    expect(getInputHistory()).toEqual([]);
  });
});

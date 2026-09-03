import type { IEditor } from '@lobehub/editor';
import { KEY_ESCAPE_COMMAND } from 'lexical';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { systemAgentSelectors } from '@/store/user/selectors';

import { getDraft, saveDraft } from '../draftStorage';
import { getInputHistory } from '../inputHistoryStorage';
import { createStore, selectors } from '.';

describe('ChatInput store actions', () => {
  beforeEach(() => {
    localStorage.clear();
    useAgentStore.setState({ activeAgentId: undefined });
    vi.restoreAllMocks();
  });

  it('keeps action lists usable when a host omits them', () => {
    const store = createStore({ leftActions: undefined, rightActions: undefined });

    expect(store.getState().leftActions).toEqual([]);
    expect(store.getState().rightActions).toEqual([]);
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
      agentId: 'agent-1',
      editor: editor as unknown as IEditor,
      onSend: ({ clearContent }) => {
        clearContent();
      },
    });

    store.getState().handleSendButton();

    expect(getInputHistory({ agentId: 'agent-1' })[0]).toMatchObject({
      json: editorData,
      markdown: 'Hello',
    });
  });

  it('drops the stored draft once the send handler clears the composer', () => {
    const editor = {
      cleanDocument: vi.fn(),
      focus: vi.fn(),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : { text: 'Hello' })),
    };
    saveDraft('main_agt_a_tpc_1', { text: 'Hello' });
    const store = createStore({
      draftKey: 'main_agt_a_tpc_1',
      editor: editor as unknown as IEditor,
      onSend: ({ clearContent }) => {
        clearContent();
      },
    });

    store.getState().handleSendButton();

    expect(getDraft('main_agt_a_tpc_1')).toBeUndefined();
  });

  it('keeps the stored draft when the send handler declines to clear the composer', () => {
    const editor = {
      cleanDocument: vi.fn(),
      focus: vi.fn(),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : { text: 'Hello' })),
    };
    saveDraft('main_agt_a_tpc_1', { text: 'Hello' });
    const store = createStore({
      draftKey: 'main_agt_a_tpc_1',
      editor: editor as unknown as IEditor,
      // a scheduled send that the server rejects leaves the text in the
      // composer, so the draft behind it must survive
      onSend: () => {},
    });

    store.getState().handleSendButton();

    expect(getDraft('main_agt_a_tpc_1')).toEqual({ text: 'Hello' });
  });

  it('records sent input in the active agent history when no agent id is provided', () => {
    useAgentStore.setState({ activeAgentId: 'active-agent' });

    const editorData = { root: { children: [{ text: 'Hello' }] } };
    const editor = {
      cleanDocument: vi.fn(),
      focus: vi.fn(),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : editorData)),
    };
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend: vi.fn(),
    });

    store.getState().handleSendButton();

    expect(getInputHistory({ agentId: 'active-agent' })[0]).toMatchObject({
      json: editorData,
      markdown: 'Hello',
    });
    expect(getInputHistory()).toEqual([]);
  });

  it('sends exactly what the document serializes to', () => {
    // The composer no longer rewrites the text on the way out: markers like the
    // goal chip are nodes in the document, so what is sent is what is shown.
    const onSend = vi.fn(({ clearContent, getMarkdownContent }) => {
      expect(getMarkdownContent()).toBe('/goal Ship the homepage');
      clearContent();
    });
    const editor = {
      cleanDocument: vi.fn(),
      focus: vi.fn(),
      getDocument: vi.fn((type: string) =>
        type === 'markdown' ? '/goal Ship the homepage' : { root: {} },
      ),
    };
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend,
    });

    store.getState().handleSendButton();

    expect(onSend).toHaveBeenCalledOnce();
    expect(editor.cleanDocument).toHaveBeenCalledOnce();
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
    expect(editor.getDocument).not.toHaveBeenCalled();
  });

  it('clears the input-completion ghost before sending when autocomplete is enabled', () => {
    vi.spyOn(systemAgentSelectors, 'inputCompletion').mockReturnValue({ enabled: true } as any);

    const dispatchCommand = vi.fn();
    const editor = {
      cleanDocument: vi.fn(),
      dispatchCommand,
      focus: vi.fn(),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : { root: {} })),
    };
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend: vi.fn(),
    });

    store.getState().handleSendButton();

    expect(dispatchCommand).toHaveBeenCalledWith(KEY_ESCAPE_COMMAND, expect.any(Object));
  });

  it('does not dispatch escape on send when autocomplete is disabled', () => {
    const dispatchCommand = vi.fn();
    const editor = {
      cleanDocument: vi.fn(),
      dispatchCommand,
      focus: vi.fn(),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : { root: {} })),
    };
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend: vi.fn(),
    });

    store.getState().handleSendButton();

    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  // Regression: sendButtonProps.disabled mirrors editor content through the
  // editor's debounced onChange, so a fast type→Enter arrives while the
  // mirror still reads "empty" and used to be silently dropped.
  it('sends via resolveSendBlocked even when the stale disabled mirror says blocked', () => {
    const onSend = vi.fn();
    const editor = {
      cleanDocument: vi.fn(),
      focus: vi.fn(),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : { root: {} })),
    };
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend,
      resolveSendBlocked: () => false,
      sendButtonProps: { disabled: true, generating: false, onStop: vi.fn() },
    });

    store.getState().handleSendButton();

    expect(onSend).toHaveBeenCalledOnce();
  });

  it('blocks the send when resolveSendBlocked reports blocked', () => {
    const onSend = vi.fn();
    const editor = {
      cleanDocument: vi.fn(),
      focus: vi.fn(),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : { root: {} })),
    };
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend,
      resolveSendBlocked: () => true,
      sendButtonProps: { disabled: false, generating: false, onStop: vi.fn() },
    });

    store.getState().handleSendButton();

    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps gating on sendButtonProps.disabled when no resolver is provided', () => {
    const onSend = vi.fn();
    const editor = {
      cleanDocument: vi.fn(),
      focus: vi.fn(),
      getDocument: vi.fn((type: string) => (type === 'markdown' ? 'Hello' : { root: {} })),
    };
    const store = createStore({
      editor: editor as unknown as IEditor,
      onSend,
      sendButtonProps: { disabled: true, generating: false, onStop: vi.fn() },
    });

    store.getState().handleSendButton();

    expect(onSend).not.toHaveBeenCalled();
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

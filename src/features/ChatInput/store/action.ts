import { type StateCreator } from 'zustand/vanilla';

import { removeDraft } from '../draftStorage';
import { addInputHistory } from '../inputHistoryStorage';
import { type PublicState, type State } from './initialState';
import { initialState } from './initialState';

export interface Action {
  clearInputCompletionError: () => void;
  dismissInputCompletionError: () => void;
  getJSONState: () => Record<string, any> | undefined;
  getMarkdownContent: () => string;
  handleSendButton: () => void;
  handleStop: () => void;
  pauseInputCompletion: (error: State['inputCompletionError']) => void;
  setDocument: (type: string, content: any, options?: Record<string, unknown>) => void;
  setExpand: (expend: boolean) => void;
  setJSONState: (content: any) => void;
  setShowTypoBar: (show: boolean) => void;
  updateMarkdownContent: () => void;
}

export type Store = Action & State;

type CreateStore = (
  initState?: Partial<PublicState>,
) => StateCreator<Store, [['zustand/devtools', never]]>;

export const store: CreateStore = (publicState) => (set, get) => ({
  ...initialState,
  ...publicState,

  clearInputCompletionError: () => {
    set({ inputCompletionError: undefined, inputCompletionErrorDismissed: false });
  },

  dismissInputCompletionError: () => {
    set({ inputCompletionError: undefined, inputCompletionErrorDismissed: false });
  },

  getJSONState: () => {
    return get().editor?.getDocument('json') as Record<string, any> | undefined;
  },
  getMarkdownContent: () => {
    return String(get().editor?.getDocument('markdown') || '').trimEnd();
  },
  handleSendButton: () => {
    const editor = get().editor;
    if (!editor) return;
    if (get().sendButtonProps?.disabled) return;

    const onSend = get().onSend;
    const markdown = get().getMarkdownContent();
    const json = get().getJSONState();

    onSend?.({
      clearContent: () => editor?.cleanDocument(),
      editor: editor!,
      getEditorData: get().getJSONState,
      getMarkdownContent: get().getMarkdownContent,
    });

    if (onSend && (get().feature?.inputHistory ?? true)) {
      addInputHistory({ json, markdown });
    }

    const { draftKey } = get();
    if (draftKey) removeDraft(draftKey);

    if (get().expand) {
      set({ _savedEditorState: undefined, expand: false });
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        editor.focus();
      });
    });
  },

  handleStop: () => {
    if (!get().editor) return;

    get().sendButtonProps?.onStop?.({ editor: get().editor! });
  },

  pauseInputCompletion: (inputCompletionError) => {
    set({ inputCompletionError, inputCompletionErrorDismissed: false });
  },

  setDocument: (type, content, options) => {
    get().editor?.setDocument(type, content, options);
  },

  setExpand: (expand) => {
    const editor = get().editor;
    const _savedEditorState = editor?.getDocument('json') as Record<string, any> | undefined;
    set({ _savedEditorState, expand });
  },

  setJSONState: (content) => {
    get().editor?.setDocument('json', content);
  },

  setShowTypoBar: (showTypoBar) => {
    set({ showTypoBar });
  },

  updateMarkdownContent: () => {
    if (!get().onMarkdownContentChange) return;

    const content = get().getMarkdownContent();

    if (content === get().markdownContent) return;

    get().onMarkdownContentChange?.(content);

    set({ markdownContent: content });
  },
});

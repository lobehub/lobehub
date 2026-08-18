import { KEY_ESCAPE_COMMAND } from 'lexical';
import { type StateCreator } from 'zustand/vanilla';

import { useAgentStore } from '@/store/agent';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors, userProfileSelectors } from '@/store/user/selectors';

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
  setActiveAudioInputMode: (mode?: State['activeAudioInputMode']) => void;
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

const getEffectiveAgentId = (agentId?: string): string => {
  // Example: a ChatInput without an agentId prop reads history from activeAgentId,
  // so sending must write history to the same scope.
  return agentId !== undefined ? agentId : useAgentStore.getState().activeAgentId || '';
};

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

    const { resolveSendBlocked, sendButtonProps } = get();
    if (resolveSendBlocked ? resolveSendBlocked() : sendButtonProps?.disabled) return;

    // Drop any pending AI input-completion ghost before serializing the message.
    // The suggestion is materialized as real placeholder nodes inside the
    // document, so sending without clearing would emit the ghost text too —
    // Enter and the send button must submit only what the user actually typed.
    // Escape is the plugin's reject path and clears those nodes synchronously.
    const autoCompleteEnabled =
      (get().feature?.inputCompletion ?? true) &&
      systemAgentSelectors.inputCompletion(useUserStore.getState()).enabled;
    if (autoCompleteEnabled) {
      editor.dispatchCommand(KEY_ESCAPE_COMMAND, new KeyboardEvent('keydown', { key: 'Escape' }));
    }

    const onSend = get().onSend;
    const historyEnabled = !!onSend && (get().feature?.inputHistory ?? true);
    const historySnapshot = historyEnabled
      ? {
          agentId: getEffectiveAgentId(get().agentId),
          json: get().getJSONState(),
          markdown: get().getMarkdownContent(),
          userId: userProfileSelectors.userId(useUserStore.getState()),
        }
      : undefined;

    // Tie the draft's fate to the composer actually being cleared: a host may
    // decline the send after the fact (a rejected scheduled send keeps the text
    // on screen), and the key is captured here because committing the send can
    // move the conversation to a freshly created topic.
    const sentDraftKey = get().draftKey;

    onSend?.({
      clearContent: () => {
        editor?.cleanDocument();
        if (sentDraftKey) removeDraft(sentDraftKey);
      },
      editor: editor!,
      getEditorData: get().getJSONState,
      getMarkdownContent: get().getMarkdownContent,
    });

    if (historySnapshot) {
      addInputHistory(historySnapshot);
    }

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

  setActiveAudioInputMode: (activeAudioInputMode) => {
    set({ activeAudioInputMode });
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

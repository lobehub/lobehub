import { toast } from '@lobehub/ui';
import { t } from 'i18next';
import { KEY_ESCAPE_COMMAND } from 'lexical';
import { type StateCreator } from 'zustand/vanilla';

import { installMarketMentions, MarketMentionInstallError } from '@/services/mentionMarketInstall';
import { useAgentStore } from '@/store/agent';
import { fileChatSelectors, useFileStore } from '@/store/file';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors, userProfileSelectors } from '@/store/user/selectors';

import { removeDraft } from '../draftStorage';
import { readDocument, writeDocument } from '../editorDocument';
import { getInstalledSkillIdentifiers } from '../InputEditor/ActionTag/useInstalledSkillsAndTools';
import {
  PRUNE_UNATTACHED_IMAGE_REFS_COMMAND,
  SYNC_IMAGE_REF_TAGS_COMMAND,
} from '../InputEditor/ImageRefTag/ImageRefTagPlugin';
import {
  applyInstalledMarketAgents,
  collectPendingMarketAgents,
  collectPendingMarketSkills,
} from '../InputEditor/marketMention';
import { addInputHistory } from '../inputHistoryStorage';
import { getImageUploadRefs } from '../utils/imageUploads';
import { type PublicState, type State } from './initialState';
import { initialState } from './initialState';
import { selectors } from './selectors';

export interface Action {
  /** Drop a send queued for uploads and stop watching them (e.g. the composer unmounts). */
  cancelUploadQueuedSend: () => void;
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
  leftActions: publicState?.leftActions ?? initialState.leftActions,
  rightActions: publicState?.rightActions ?? initialState.rightActions,

  cancelUploadQueuedSend: () => {
    const queued = get().uploadQueuedSend;
    if (!queued) return;
    queued.unsubscribe();
    set({ uploadQueuedSend: undefined });
  },

  clearInputCompletionError: () => {
    set({ inputCompletionError: undefined, inputCompletionErrorDismissed: false });
  },

  dismissInputCompletionError: () => {
    set({ inputCompletionError: undefined, inputCompletionErrorDismissed: false });
  },

  getJSONState: () => {
    return readDocument(get().editor, 'json') as Record<string, any> | undefined;
  },
  getMarkdownContent: () => {
    return String(readDocument(get().editor, 'markdown', { format: false }) || '').trimEnd();
  },
  handleSendButton: () => {
    const editor = get().editor;
    if (!editor) return;

    const { installingMarketMentions, resolveSendBlocked, sendButtonProps } = get();
    if (installingMarketMentions) return;
    if (selectors.isSendQueuedForUploads(get())) return;
    if (resolveSendBlocked ? resolveSendBlocked() : sendButtonProps?.disabled) return;

    // Uploads still in flight: queue the send instead of refusing it. The composer keeps
    // its content (and stays editable) until every upload settles, then the send goes
    // through this same path with whatever the composer holds by then, so an edit made
    // while waiting is sent too and a failed upload is left for the host to drop.
    const uploadKey = get().uploadContextKey ?? get().contextSelectionKey;
    if (
      get().queueSendWhileUploading &&
      uploadKey &&
      fileChatSelectors.isUploadingFiles(uploadKey)(useFileStore.getState())
    ) {
      const queued = { draftKey: get().draftKey, unsubscribe: () => {} };
      set({ uploadQueuedSend: queued });
      const unsubscribe = useFileStore.subscribe((fileState) => {
        if (fileChatSelectors.isUploadingFiles(uploadKey)(fileState)) return;
        unsubscribe();
        // A newer queued send (made after a conversation switch) owns the state now.
        if (get().uploadQueuedSend !== queued) return;
        set({ uploadQueuedSend: undefined });
        // The composer outlives a conversation switch; the conversation it now
        // shows never asked to send, so the send is dropped.
        if (get().draftKey !== queued.draftKey) return;

        // The inline references re-sync from a React effect that has not run yet at
        // this point; bring them in line with the settled uploads first, so a failed
        // image loses its [Image #N] and the rest keep the numbers they are sent with.
        get().editor?.dispatchCommand(SYNC_IMAGE_REF_TAGS_COMMAND, {
          refs: getImageUploadRefs(fileChatSelectors.chatUploadFileList(uploadKey)(fileState)),
        });
        get().handleSendButton();
      });
      queued.unsubscribe = unsubscribe;
      return;
    }

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

    // A chip whose image is not attached (a draft restored after a reload) is not sent as
    // [Image #N]; drop it so the sent bubble does not show it either.
    editor.dispatchCommand(PRUNE_UNATTACHED_IMAGE_REFS_COMMAND, undefined);

    const commit = (installedAgentIds: ReadonlyMap<string, string> = new Map()) => {
      // Market chips picked from the @ menu were installed just before this
      // commit: every read of the content sees the installed agent ids.
      const readContent = () =>
        applyInstalledMarketAgents(
          { editorData: get().getJSONState(), markdown: get().getMarkdownContent() },
          installedAgentIds,
        );

      const onSend = get().onSend;
      const historyEnabled = !!onSend && (get().feature?.inputHistory ?? true);
      const historySnapshot = historyEnabled
        ? (() => {
            const { editorData, markdown } = readContent();
            return {
              agentId: getEffectiveAgentId(get().agentId),
              json: editorData,
              markdown,
              userId: userProfileSelectors.userId(useUserStore.getState()),
            };
          })()
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
        getEditorData: () => readContent().editorData,
        getMarkdownContent: () => readContent().markdown,
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
    };

    // Nothing would consume the message, so there is nothing worth installing for.
    if (!get().onSend) {
      commit();
      return;
    }

    const editorData = get().getJSONState();
    const pending = {
      agents: collectPendingMarketAgents(editorData),
      skills: collectPendingMarketSkills(editorData, getInstalledSkillIdentifiers()),
    };
    if (pending.agents.length === 0 && pending.skills.length === 0) {
      commit();
      return;
    }

    // Install what the message picked from the Market, then send. The composer
    // keeps its content until the install succeeds, so a failure loses nothing;
    // the send button's spinner is the only progress cue while it waits.
    const names = [...pending.agents, ...pending.skills].map((item) => item.label).join('、');
    const submitted = JSON.stringify(editorData);
    const submittedDraftKey = get().draftKey;
    set({ installingMarketMentions: true });
    installMarketMentions(pending)
      .then((installedAgentIds) => {
        set({ installingMarketMentions: false });
        // The composer outlives a conversation switch; the conversation it now
        // shows never asked to send, so the send is dropped.
        if (get().draftKey !== submittedDraftKey) return;
        // The composer stays editable meanwhile: an edit may pick other Market
        // entries, so send its current content through the same preparation.
        if (JSON.stringify(get().getJSONState()) !== submitted) {
          get().handleSendButton();
          return;
        }
        commit(installedAgentIds);
      })
      .catch((error) => {
        set({ installingMarketMentions: false });
        const failed =
          error instanceof MarketMentionInstallError ? error.failedNames.join('、') : names;
        toast.error(t('mention.marketInstall.failed', { names: failed, ns: 'chat' }));
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
    writeDocument(get().editor, type, content, options);
  },

  setExpand: (expand) => {
    const editor = get().editor;
    const _savedEditorState = readDocument(editor, 'json') as Record<string, any> | undefined;
    set({ _savedEditorState, expand });
  },

  setJSONState: (content) => {
    writeDocument(get().editor, 'json', content);
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

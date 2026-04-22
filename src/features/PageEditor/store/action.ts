import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT, isDesktop } from '@lobechat/const';
import debug from 'debug';
import { debounce } from 'es-toolkit/compat';
import { type StateCreator } from 'zustand';

import { useDocumentStore } from '@/store/document';
import { getElectronStoreState } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { useFileStore } from '@/store/file';

import { type RightPanelMode, type State } from './initialState';
import { initialState } from './initialState';

const log = debug('page:editor');

export interface Action {
  flushMetaSave: () => void;
  handleCopyLink: (t: (key: string) => string, message: any) => void;
  handleDelete: (
    t: (key: string) => string,
    message: any,
    modal: any,
    onDeleteCallback?: () => void,
  ) => Promise<void>;
  handleTitleSubmit: () => Promise<void>;
  initMeta: (title?: string, emoji?: string) => void;
  performMetaSave: () => Promise<void>;
  setEmoji: (emoji: string | undefined) => void;
  setRightPanelMode: (mode: RightPanelMode) => void;
  setTitle: (title: string) => void;
  triggerDebouncedMetaSave: () => void;
}

export type Store = State & Action;

export const store: (initState?: Partial<State>) => StateCreator<Store> =
  (initState) => (set, get) => {
    // Debounced save function for meta (title/emoji)
    let debouncedMetaSave: ReturnType<typeof debounce> | null = null;

    const getOrCreateDebouncedMetaSave = () => {
      if (!debouncedMetaSave) {
        debouncedMetaSave = debounce(
          async () => {
            try {
              await get().performMetaSave();
            } catch (error) {
              console.error('[PageEditor] Failed to auto-save meta:', error);
            }
          },
          EDITOR_DEBOUNCE_TIME,
          { leading: false, maxWait: EDITOR_MAX_WAIT, trailing: true },
        );
      }
      return debouncedMetaSave;
    };

    return {
      ...initialState,
      ...initState,

      flushMetaSave: () => {
        debouncedMetaSave?.flush();
      },

      handleCopyLink: (t, message) => {
        const { documentId } = get();
        if (documentId) {
          const appOrigin = isDesktop
            ? electronSyncSelectors.remoteServerUrl(getElectronStoreState())
            : window.location.origin;
          const url = `${appOrigin}${window.location.pathname}`;
          navigator.clipboard.writeText(url);
          message.success(t('pageEditor.linkCopied'));
        }
      },

      handleDelete: async (t, message, modal, onDeleteCallback) => {
        const { documentId } = get();
        if (!documentId) return;

        return new Promise((resolve, reject) => {
          modal.confirm({
            cancelText: t('cancel'),
            content: t('pageEditor.deleteConfirm.content'),
            okButtonProps: { danger: true },
            okText: t('delete'),
            onOk: async () => {
              try {
                const { removeDocument } = useFileStore.getState();
                await removeDocument(documentId);
                message.success(t('pageEditor.deleteSuccess'));
                onDeleteCallback?.();
                resolve();
              } catch (error) {
                log('Failed to delete page:', error);
                message.error(t('pageEditor.deleteError'));
                reject(error);
              }
            },
            title: t('pageEditor.deleteConfirm.title'),
          });
        });
      },

      handleTitleSubmit: async () => {
        const { editor, flushMetaSave } = get();

        // Flush pending save and focus editor
        flushMetaSave();
        editor?.focus();
      },

      initMeta: (title, emoji) => {
        set({
          emoji,
          isMetaDirty: false,
          lastSavedEmoji: emoji,
          lastSavedTitle: title,
          metaSaveStatus: 'idle',
          title,
        });
      },

      performMetaSave: async () => {
        const {
          documentId,
          title,
          emoji,
          lastSavedTitle,
          lastSavedEmoji,
          isMetaDirty,
          onTitleChange,
          onEmojiChange,
        } = get();

        if (!documentId || !isMetaDirty) return;

        set({ metaSaveStatus: 'saving' });

        try {
          // Trigger save via DocumentStore with metadata
          await useDocumentStore.getState().performSave(
            documentId,
            {
              emoji,
              title,
            },
            { saveSource: 'autosave' },
          );

          // Notify parent after successful save
          if (title !== lastSavedTitle) {
            onTitleChange?.(title || '');
          }
          if (emoji !== lastSavedEmoji) {
            onEmojiChange?.(emoji);
          }

          set({
            isMetaDirty: false,
            lastSavedEmoji: emoji,
            lastSavedTitle: title,
            metaSaveStatus: 'saved',
          });
        } catch (error) {
          console.error('[PageEditor] Failed to save meta:', error);
          set({ metaSaveStatus: 'idle' });
        }
      },

      setEmoji: (emoji: string | undefined) => {
        const { lastSavedEmoji, triggerDebouncedMetaSave } = get();

        const isDirty = emoji !== lastSavedEmoji;
        set({ emoji, isMetaDirty: isDirty });

        if (isDirty) {
          triggerDebouncedMetaSave();
        }
      },

      setRightPanelMode: (rightPanelMode) => {
        set({ rightPanelMode });
      },

      setTitle: (title: string) => {
        const { lastSavedTitle, triggerDebouncedMetaSave } = get();

        const isDirty = title !== lastSavedTitle;
        set({ isMetaDirty: isDirty, title });

        if (isDirty) {
          triggerDebouncedMetaSave();
        }
      },

      triggerDebouncedMetaSave: () => {
        const save = getOrCreateDebouncedMetaSave();
        save();
      },
    };
  };

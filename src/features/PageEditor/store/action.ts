import debug from 'debug';
import { type StateCreator } from 'zustand';

import { useDocumentStore } from '@/store/document';
import { useFileStore } from '@/store/file';

import { type State, initialState } from './initialState';

const log = debug('page:editor');

export interface Action {
  handleCopyLink: (t: (key: string) => string, message: any) => void;
  handleDelete: (
    t: (key: string) => string,
    message: any,
    modal: any,
    onDeleteCallback?: () => void,
  ) => Promise<void>;
  handleTitleSubmit: () => Promise<void>;
  setEmoji: (emoji: string | undefined) => void;
  setTitle: (title: string) => void;
}

export type Store = State & Action;

export const store: (initState?: Partial<State>) => StateCreator<Store> =
  (initState) => (set, get) => {
    return {
      ...initialState,
      ...initState,

      handleCopyLink: (t, message) => {
        const { documentId } = get();
        if (documentId) {
          const url = `${window.location.origin}${window.location.pathname}`;
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
        const { documentId, title, emoji, editor } = get();
        if (!documentId) return;

        // Trigger save via DocumentStore with metadata
        await useDocumentStore.getState().performSave(documentId, {
          emoji,
          title,
        });

        editor?.focus();
      },

      setEmoji: (emoji: string | undefined) => {
        const { documentId } = get();
        set({ emoji });

        // Mark document as dirty in DocumentStore
        if (documentId) {
          useDocumentStore.getState().markDirty(documentId);
        }
      },

      setTitle: (title: string) => {
        const { documentId } = get();
        set({ title });

        // Mark document as dirty in DocumentStore
        if (documentId) {
          useDocumentStore.getState().markDirty(documentId);
        }
      },
    };
  };

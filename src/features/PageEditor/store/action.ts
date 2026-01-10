import { EDITOR_DEBOUNCE_TIME, EDITOR_MAX_WAIT } from '@lobechat/const';
import debug from 'debug';
import { debounce } from 'es-toolkit/compat';
import { type StateCreator } from 'zustand';

import { documentService } from '@/services/document';
import { useFileStore } from '@/store/file';
import { pageAgentRuntime } from '@/store/tool/slices/builtin/executors/lobe-page-agent';
import { DocumentSourceType, type LobeDocument } from '@/types/document';

import { type State, initialState } from './initialState';

const log = debug('page:editor');

export interface Action {
  flushSave: () => void;
  handleContentChange: () => void;
  handleCopyLink: (t: (key: string) => string, message: any) => void;
  handleDelete: (
    t: (key: string) => string,
    message: any,
    modal: any,
    onDeleteCallback?: () => void,
  ) => Promise<void>;
  handleTitleSubmit: () => Promise<void>;
  onEditorInit: () => void;
  performSave: (options?: { force?: boolean }) => Promise<void>;
  setCurrentEmoji: (emoji: string | undefined) => void;
  setCurrentTitle: (title: string) => void;
}

export type Store = State & Action;

// Create debounced save function outside of store for reuse
const createDebouncedSave = (get: () => Store) =>
  debounce(
    async () => {
      try {
        await get().performSave();
      } catch (error) {
        log('Failed to auto-save:', error);
      }
    },
    EDITOR_DEBOUNCE_TIME,
    { leading: false, maxWait: EDITOR_MAX_WAIT, trailing: true },
  );

export const store: (initState?: Partial<State>) => StateCreator<Store> =
  (initState) => (set, get) => {
    const debouncedSave = createDebouncedSave(get);

    return {
      ...initialState,
      ...initState,

      flushSave: () => {
        debouncedSave.flush();
      },

      handleContentChange: () => {
        const { editor, lastSavedContent } = get();
        if (!editor) return;

        try {
          const textContent = (editor.getDocument('text') as unknown as string) || '';
          const markdownContent = (editor.getDocument('markdown') as unknown as string) || '';
          const wordCount = textContent.trim().split(/\s+/).filter(Boolean).length;

          // Check if content actually changed
          const contentChanged = markdownContent !== lastSavedContent;

          set({ isDirty: contentChanged, wordCount });

          // Only trigger auto-save if content actually changed
          if (contentChanged) {
            debouncedSave();
          }
        } catch (error) {
          log('Failed to update content:', error);
        }
      },

      handleCopyLink: (t, message) => {
        const { currentDocId } = get();
        if (currentDocId) {
          const url = `${window.location.origin}${window.location.pathname}`;
          navigator.clipboard.writeText(url);
          message.success(t('pageEditor.linkCopied'));
        }
      },

      handleDelete: async (t, message, modal, onDeleteCallback) => {
        const { currentDocId } = get();
        if (!currentDocId) return;

        return new Promise((resolve, reject) => {
          modal.confirm({
            cancelText: t('cancel'),
            content: t('pageEditor.deleteConfirm.content'),
            okButtonProps: { danger: true },
            okText: t('delete'),
            onOk: async () => {
              try {
                const { removeDocument } = useFileStore.getState();
                await removeDocument(currentDocId);
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
        const { performSave, editor } = get();
        await performSave();
        editor?.focus();
      },

      onEditorInit: () => {
        // Called when editor is initialized
        const { editor, setCurrentTitle, currentTitle } = get();

        if (editor) {
          // Connect the editor instance to the page agent runtime
          pageAgentRuntime.setEditor(editor);

          // Set up title handlers for the runtime
          pageAgentRuntime.setTitleHandlers(
            (title: string) => setCurrentTitle(title),
            () => currentTitle,
          );

          log('Connected editor to page agent runtime');
        }
      },

      performSave: async (options) => {
        const {
          editor,
          currentDocId,
          currentTitle,
          currentEmoji,
          knowledgeBaseId,
          parentId,
          onDocumentIdChange,
          onSave,
          isDirty,
        } = get();

        if (!editor) return;

        // Skip save if no changes (unless force is true)
        if (
          !options?.force &&
          !isDirty &&
          currentDocId &&
          !currentDocId.startsWith('temp-document-')
        ) {
          return;
        }

        set({ saveStatus: 'saving' });

        try {
          const editorElement = editor.getRootElement();
          const hadFocus = editorElement?.contains(document.activeElement) ?? false;

          const currentEditorData = editor.getDocument('json');
          const currentContent = (editor.getDocument('markdown') as unknown as string) || '';

          // Don't save if there's no content AND no title/emoji changes
          if (!currentContent?.trim() && !currentTitle?.trim() && !currentEmoji) {
            set({ saveStatus: 'idle' });
            return;
          }

          const { updateDocumentOptimistically, replaceTempDocumentWithReal } =
            useFileStore.getState();

          if (currentDocId && !currentDocId.startsWith('temp-document-')) {
            await updateDocumentOptimistically(currentDocId, {
              content: currentContent,
              editorData: structuredClone(currentEditorData),
              metadata: currentEmoji ? { emoji: currentEmoji } : { emoji: undefined },
              title: currentTitle,
              updatedAt: new Date(),
            });
          } else {
            const now = Date.now();
            const timestamp = new Date(now).toLocaleString('en-US', {
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              month: 'short',
              year: 'numeric',
            });
            const finalTitle = currentTitle || `Page - ${timestamp}`;

            const newPage = await documentService.createDocument({
              content: currentContent,
              editorData: JSON.stringify(currentEditorData),
              fileType: 'custom/document',
              knowledgeBaseId,
              metadata: {
                createdAt: now,
                ...(currentEmoji ? { emoji: currentEmoji } : {}),
              },
              parentId,
              title: finalTitle,
            });

            const realPage: LobeDocument = {
              content: currentContent,
              createdAt: new Date(now),
              editorData: structuredClone(currentEditorData) || null,
              fileType: 'custom/document' as const,
              filename: finalTitle,
              id: newPage.id,
              metadata: {
                createdAt: now,
                ...(currentEmoji ? { emoji: currentEmoji } : {}),
              },
              source: 'document',
              sourceType: DocumentSourceType.EDITOR,
              title: finalTitle,
              totalCharCount: currentContent.length,
              totalLineCount: 0,
              updatedAt: new Date(now),
            };

            if (currentDocId?.startsWith('temp-document-')) {
              replaceTempDocumentWithReal(currentDocId, realPage);
            }

            set({ currentDocId: newPage.id });
            onDocumentIdChange?.(newPage.id);

            // Refetch resource list to show newly created page
            const { revalidateResources } = await import('@/store/file/slices/resource/hooks');
            await revalidateResources();
          }

          if (hadFocus) {
            setTimeout(() => {
              editor?.focus();
            }, 0);
          }

          // Mark as clean and update save status
          set({
            isDirty: false,
            lastSavedContent: currentContent,
            lastUpdatedTime: new Date(),
            saveStatus: 'saved',
          });
          onSave?.();
        } catch (error) {
          log('Failed to save:', error);
          set({ saveStatus: 'idle' });
        }
      },

      setCurrentEmoji: (emoji: string | undefined) => {
        set({ currentEmoji: emoji, isDirty: true });
        debouncedSave();
      },

      setCurrentTitle: (title: string) => {
        set({ currentTitle: title, isDirty: true });
        debouncedSave();
      },
    };
  };

'use client';

import { useEditor } from '@lobehub/editor/react';
import { memo, useEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { hasMeaningfulEditorContent } from '@/libs/editor/hasMeaningfulEditorContent';
import { documentHistoryQueueService } from '@/services/documentHistoryQueue';
import { useDocumentStore } from '@/store/document';
import { pageAgentRuntime } from '@/store/tool/slices/builtin/executors/lobe-page-agent';

import { type PublicState } from './store';
import { usePageEditorStore, useStoreApi } from './store';

type PageAgentEditor = NonNullable<Parameters<typeof pageAgentRuntime.setEditor>[0]>;

export interface StoreUpdaterProps extends Partial<PublicState> {
  pageId?: string;
}

/**
 * StoreUpdater syncs PageEditorStore props and connects to page agent runtime.
 *
 * Note: Document content loading is handled by EditorCanvas via DocumentStore.
 * Title/emoji are consumed from PageEditorStore (set via setCurrentTitle/setCurrentEmoji).
 */
const StoreUpdater = memo<StoreUpdaterProps>(
  ({
    pageId,
    knowledgeBaseId,
    onDocumentIdChange,
    onEmojiChange,
    onSave,
    onTitleChange,
    onDelete,
    onBack,
    parentId,
    title,
    emoji,
  }) => {
    const storeApi = useStoreApi();
    const useStoreUpdater = createStoreUpdater(storeApi);

    const initMeta = usePageEditorStore((s) => s.initMeta);

    // Read the editor directly from the EditorProvider context so that the runtime
    // always receives the latest editor instance, even if the store was created
    // before the editor finished initializing.
    const editorFromContext = useEditor();
    const pageAgentEditor = editorFromContext as unknown as PageAgentEditor | undefined;

    // Update store with props
    useStoreUpdater('documentId', pageId);
    useStoreUpdater('knowledgeBaseId', knowledgeBaseId);
    useStoreUpdater('onDocumentIdChange', onDocumentIdChange);
    useStoreUpdater('onEmojiChange', onEmojiChange);
    useStoreUpdater('onSave', onSave);
    useStoreUpdater('onTitleChange', onTitleChange);
    useStoreUpdater('onDelete', onDelete);
    useStoreUpdater('onBack', onBack);
    useStoreUpdater('parentId', parentId);

    // Initialize meta (title/emoji) with dirty tracking
    useEffect(() => {
      initMeta(title, emoji);
    }, [pageId, title, emoji, initMeta]);

    // Connect editor to page agent runtime using the live context value so the
    // runtime is updated as soon as the editor is available, regardless of when
    // the store was initialized.
    useEffect(() => {
      if (pageAgentEditor) {
        pageAgentRuntime.setEditor(pageAgentEditor);
      }
      return () => {
        pageAgentRuntime.setEditor(null);
      };
    }, [pageAgentEditor]);

    // Connect title handlers and document ID to page agent runtime
    useEffect(() => {
      const titleGetter = () => {
        return storeApi.getState().title || '';
      };

      pageAgentRuntime.setCurrentDocId(pageId);
      pageAgentRuntime.setTitleHandlers(storeApi.getState().setTitle, titleGetter);
      pageAgentRuntime.setBeforeMutateHandler(() => {
        const editor = storeApi.getState().editor;
        const editorData = editor?.getDocument('json');

        if (!hasMeaningfulEditorContent(editorData)) {
          return;
        }

        documentHistoryQueueService.enqueueEditorSnapshot({
          documentId: pageId,
          editor,
        });
      });
      pageAgentRuntime.setAfterMutateHandler(async () => {
        if (!pageId) return;

        await useDocumentStore.getState().commitEditorMutation(pageId, { saveSource: 'llm_call' });
      });

      return () => {
        pageAgentRuntime.setCurrentDocId(undefined);
        pageAgentRuntime.setAfterMutateHandler(null);
        pageAgentRuntime.setTitleHandlers(null, null);
        pageAgentRuntime.setBeforeMutateHandler(null);
        void documentHistoryQueueService.flush();
      };
    }, [pageId, storeApi]);

    return null;
  },
);

export default StoreUpdater;

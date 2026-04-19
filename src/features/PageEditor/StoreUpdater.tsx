'use client';

import debug from 'debug';
import { memo, useEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { documentHistoryQueueService } from '@/services/documentHistoryQueue';
import { pageAgentRuntime } from '@/store/tool/slices/builtin/executors/lobe-page-agent';

import { type PublicState } from './store';
import { usePageEditorStore, useStoreApi } from './store';

const log = debug('page:editor:store-updater');

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

    const editor = usePageEditorStore((s) => s.editor);
    const initMeta = usePageEditorStore((s) => s.initMeta);
    const pageAgentEditor = editor as unknown as PageAgentEditor | undefined;

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

    // Connect editor to page agent runtime
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
        if (!pageId) return;
        const editor = storeApi.getState().editor;
        if (!editor) return;
        try {
          const editorData = editor.getDocument('json');
          documentHistoryQueueService.enqueue({
            documentId: pageId,
            editorData: JSON.stringify(editorData),
            saveSource: 'llm_call',
          });
        } catch (error) {
          log('Failed to capture history snapshot before mutation: %o', error);
        }
      });

      return () => {
        pageAgentRuntime.setCurrentDocId(undefined);
        pageAgentRuntime.setTitleHandlers(null, null);
        pageAgentRuntime.setBeforeMutateHandler(null);
        void documentHistoryQueueService.flush();
      };
    }, [pageId, storeApi]);

    return null;
  },
);

export default StoreUpdater;

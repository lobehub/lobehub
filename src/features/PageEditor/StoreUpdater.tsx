'use client';

import { memo, useEffect } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { pageAgentRuntime } from '@/store/tool/slices/builtin/executors/lobe-page-agent';

import { type PublicState, usePageEditorStore, useStoreApi } from './store';

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
  ({ pageId, knowledgeBaseId, onDocumentIdChange, onSave, onDelete, onBack, parentId }) => {
    const storeApi = useStoreApi();
    const useStoreUpdater = createStoreUpdater(storeApi);

    const editor = usePageEditorStore((s) => s.editor);

    // Update store with props
    useStoreUpdater('documentId', pageId);
    useStoreUpdater('knowledgeBaseId', knowledgeBaseId);
    useStoreUpdater('onDocumentIdChange', onDocumentIdChange);
    useStoreUpdater('onSave', onSave);
    useStoreUpdater('onDelete', onDelete);
    useStoreUpdater('onBack', onBack);
    useStoreUpdater('parentId', parentId);

    // Connect editor to page agent runtime
    useEffect(() => {
      if (editor) {
        pageAgentRuntime.setEditor(editor);
      }
      return () => {
        pageAgentRuntime.setEditor(null);
      };
    }, [editor]);

    // Connect title handlers and document ID to page agent runtime
    useEffect(() => {
      const titleSetter = (t: string) => {
        storeApi.setState({ title: t });
      };

      const titleGetter = () => {
        return storeApi.getState().title;
      };

      pageAgentRuntime.setCurrentDocId(pageId);
      pageAgentRuntime.setTitleHandlers(titleSetter, titleGetter);

      return () => {
        pageAgentRuntime.setCurrentDocId(undefined);
        pageAgentRuntime.setTitleHandlers(null, null);
      };
    }, [pageId, storeApi]);

    return null;
  },
);

export default StoreUpdater;

'use client';

import debug from 'debug';
import { memo, useEffect, useRef, useState } from 'react';
import { createStoreUpdater } from 'zustand-utils';

import { useNotebookStore } from '@/store/notebook';
import { notebookSelectors } from '@/store/notebook/selectors';

import { useDocumentEditorStore, useDocumentEditorStoreApi } from './store';

const log = debug('portal:document-store-updater');

interface StoreUpdaterProps {
  documentId: string | undefined;
  topicId: string | undefined;
}

const StoreUpdater = memo<StoreUpdaterProps>(({ documentId, topicId }) => {
  const storeApi = useDocumentEditorStoreApi();
  const useStoreUpdater = createStoreUpdater(storeApi);

  const editor = useDocumentEditorStore((s) => s.editor);

  const document = useNotebookStore(notebookSelectors.getDocumentById(topicId, documentId));

  const [editorInit, setEditorInit] = useState(false);
  const [contentInit, setContentInit] = useState(false);
  const lastLoadedDocIdRef = useRef<string | undefined>(undefined);

  // Update store with props
  useStoreUpdater('documentId', documentId);
  useStoreUpdater('topicId', topicId);

  // Load content into editor when document changes
  useEffect(() => {
    if (!editorInit || !editor || !document) return;

    // Skip if already initialized for this document
    if (contentInit && lastLoadedDocIdRef.current === documentId) return;

    // Reset content init when document changes
    if (lastLoadedDocIdRef.current !== documentId) {
      setContentInit(false);
    }

    queueMicrotask(() => {
      try {
        log('Loading content for document:', documentId);

        const content = document.content || '';

        // Set state before setDocument to ensure lastSavedContent is correct
        // when handleContentChange is triggered
        storeApi.setState({
          currentTitle: document.title || '',
          lastSavedContent: content,
        });

        editor.setDocument('markdown', content || ' ');

        lastLoadedDocIdRef.current = documentId;
        setContentInit(true);
      } catch (error) {
        log('Failed to load editor content:', error);
      }
    });
  }, [editorInit, editor, document, documentId, contentInit, storeApi]);

  // Track editor initialization
  useEffect(() => {
    if (editor && !editorInit) {
      setEditorInit(true);
    }
  }, [editor, editorInit]);

  return null;
});

export default StoreUpdater;

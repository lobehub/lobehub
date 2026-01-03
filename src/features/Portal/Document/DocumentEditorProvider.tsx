'use client';

import { useEditor } from '@lobehub/editor/react';
import { type ReactNode, memo } from 'react';

import StoreUpdater from './StoreUpdater';
import { DocumentEditorProvider as Provider, createStore } from './store';

interface DocumentEditorProviderProps {
  children: ReactNode;
  documentId: string | undefined;
  topicId: string | undefined;
}

export const DocumentEditorProvider = memo<DocumentEditorProviderProps>(
  ({ children, documentId, topicId }) => {
    const editor = useEditor();

    return (
      <Provider
        createStore={() =>
          createStore({
            documentId,
            editor,
            topicId,
          })
        }
      >
        <StoreUpdater documentId={documentId} topicId={topicId} />
        {children}
      </Provider>
    );
  },
);

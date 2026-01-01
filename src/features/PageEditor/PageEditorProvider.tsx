'use client';

import { useEditor } from '@lobehub/editor/react';
import { type ReactNode, memo } from 'react';

import StoreUpdater, { type StoreUpdaterProps } from './StoreUpdater';
import { Provider, createStore } from './store';

interface PageEditorProviderProps extends StoreUpdaterProps {
  children: ReactNode;
}

/**
 * Provide necessary methods and state for the page editor
 */
export const PageEditorProvider = memo<PageEditorProviderProps>(
  ({
    children,
    pageId,
    knowledgeBaseId,
    onDocumentIdChange,
    onSave,
    onDelete,
    onBack,
    parentId,
  }) => {
    const editor = useEditor();

    return (
      <Provider
        createStore={() =>
          createStore({
            editor,
            knowledgeBaseId,
            onBack,
            onDelete,
            onDocumentIdChange,
            onSave,
            pageId,
            parentId,
          })
        }
      >
        <StoreUpdater
          knowledgeBaseId={knowledgeBaseId}
          onBack={onBack}
          onDelete={onDelete}
          onDocumentIdChange={onDocumentIdChange}
          onSave={onSave}
          pageId={pageId}
          parentId={parentId}
        />
        {children}
      </Provider>
    );
  },
);

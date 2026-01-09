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
    title,
    emoji,
  }) => {
    const editor = useEditor();

    return (
      <Provider
        createStore={() =>
          createStore({
            documentId: pageId,
            editor,
            emoji,
            knowledgeBaseId,
            onBack,
            onDelete,
            onDocumentIdChange,
            onSave,
            parentId,
            title,
          })
        }
      >
        <StoreUpdater
          emoji={emoji}
          knowledgeBaseId={knowledgeBaseId}
          onBack={onBack}
          onDelete={onDelete}
          onDocumentIdChange={onDocumentIdChange}
          onSave={onSave}
          pageId={pageId}
          parentId={parentId}
          title={title}
        />
        {children}
      </Provider>
    );
  },
);

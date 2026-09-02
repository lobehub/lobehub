'use client';

import { useEditor } from '@lobehub/editor/react';
import { type ReactNode, useEffect, useRef } from 'react';
import { memo } from 'react';

import { createStore, Provider } from './store';
import { type StoreUpdaterProps } from './StoreUpdater';
import StoreUpdater from './StoreUpdater';

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
    metaReadOnly,
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
    const editor = useEditor();
    const cleanupGenerationRef = useRef(0);

    useEffect(() => {
      const generation = ++cleanupGenerationRef.current;

      return () => {
        queueMicrotask(() => {
          // StrictMode replays effects during development. A later setup owns
          // the same editor, while a real page-provider unmount destroys it.
          // The current ref value is intentionally checked after the microtask.
          // eslint-disable-next-line react-hooks/exhaustive-deps
          if (cleanupGenerationRef.current === generation) editor.destroy();
        });
      };
    }, [editor]);

    return (
      <Provider
        createStore={() =>
          createStore({
            documentId: pageId,
            editor,
            emoji,
            knowledgeBaseId,
            metaReadOnly,
            onBack,
            onDelete,
            onDocumentIdChange,
            onEmojiChange,
            onSave,
            onTitleChange,
            parentId,
            title,
          })
        }
      >
        <StoreUpdater
          emoji={emoji}
          knowledgeBaseId={knowledgeBaseId}
          metaReadOnly={metaReadOnly}
          pageId={pageId}
          parentId={parentId}
          title={title}
          onBack={onBack}
          onDelete={onDelete}
          onDocumentIdChange={onDocumentIdChange}
          onEmojiChange={onEmojiChange}
          onSave={onSave}
          onTitleChange={onTitleChange}
        />
        {children}
      </Provider>
    );
  },
);

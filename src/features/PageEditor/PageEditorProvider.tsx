'use client';

import { AISessionPlugin, type IEditor, Kernel } from '@lobehub/editor';
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { memo } from 'react';

import { createStore, Provider } from './store';
import { type StoreUpdaterProps } from './StoreUpdater';
import StoreUpdater from './StoreUpdater';

interface PageEditorEditorLifecycleValue {
  editor: IEditor;
  generation: number;
  resetEditor: () => void;
}

const PageEditorEditorLifecycleContext = createContext<PageEditorEditorLifecycleValue | null>(null);

const createPageEditor = (): IEditor => {
  const editor = new Kernel();
  editor.registerPlugins([AISessionPlugin]);
  return editor;
};

export const usePageEditorEditorLifecycle = (): PageEditorEditorLifecycleValue | null =>
  use(PageEditorEditorLifecycleContext);

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
    const initialEditor = useMemo(createPageEditor, []);
    const [editor, setEditor] = useState<IEditor>(() => initialEditor);
    const [editorGeneration, setEditorGeneration] = useState(0);
    const editorRef = useRef(editor);
    editorRef.current = editor;
    const cleanupGenerationRef = useRef(0);

    const resetEditor = useCallback(() => {
      const previousEditor = editorRef.current;
      previousEditor.destroy();

      const nextEditor = createPageEditor();
      editorRef.current = nextEditor;
      setEditor(nextEditor);
      setEditorGeneration((generation) => generation + 1);
    }, []);

    const editorLifecycle = useMemo(
      () => ({ editor, generation: editorGeneration, resetEditor }),
      [editor, editorGeneration, resetEditor],
    );

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
          editor={editor}
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
        <PageEditorEditorLifecycleContext value={editorLifecycle}>
          {children}
        </PageEditorEditorLifecycleContext>
      </Provider>
    );
  },
);

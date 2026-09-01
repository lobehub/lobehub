import type { IEditor } from '@lobehub/editor';
import { useEffect, useRef } from 'react';

/**
 * React Activity disconnects effects while preserving hidden DOM. Detach the
 * Lexical root while inactive, then reconnect the same element when visible.
 */
export const useEditorRootLifecycle = (editor: IEditor) => {
  const disconnectObserverRef = useRef<MutationObserver | null>(null);
  const destroyedEditorRef = useRef<IEditor | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const inactiveEditorRef = useRef<{
    lexicalEditor: NonNullable<ReturnType<IEditor['getLexicalEditor']>>;
    root: HTMLElement;
  } | null>(null);

  useEffect(() => {
    disconnectObserverRef.current?.disconnect();
    disconnectObserverRef.current = null;

    const inactiveEditor = inactiveEditorRef.current;
    const lexicalEditor = inactiveEditor?.lexicalEditor ?? editor.getLexicalEditor();
    if (!lexicalEditor) return;

    if (inactiveEditor) {
      lexicalEditor.setRootElement(inactiveEditor.root);
      inactiveEditorRef.current = null;
    }
    rootRef.current = lexicalEditor.getRootElement();

    return () => {
      // The root is read from our own ref as well, because a future editor
      // release may detach it from a ref cleanup, which React runs before this
      // passive cleanup — leaving getRootElement() already null.
      const root = lexicalEditor.getRootElement() ?? rootRef.current;
      lexicalEditor.setRootElement(null);
      rootRef.current = null;

      if (!root) return;
      inactiveEditorRef.current = { lexicalEditor, root };

      const destroyWhenDisconnected = () => {
        if (root.isConnected || destroyedEditorRef.current === editor) return;
        destroyedEditorRef.current = editor;
        observer.disconnect();
        if (disconnectObserverRef.current === observer) disconnectObserverRef.current = null;
        inactiveEditorRef.current = null;
        editor.destroy();
      };
      const observer = new MutationObserver(destroyWhenDisconnected);
      observer.observe(root.ownerDocument, { childList: true, subtree: true });
      disconnectObserverRef.current = observer;
      queueMicrotask(destroyWhenDisconnected);
    };
  }, [editor]);
};

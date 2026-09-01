import type { IEditor } from '@lobehub/editor';
import { useEffect, useRef } from 'react';

/**
 * React Activity disconnects effects while preserving hidden DOM. Detach the
 * Lexical root while inactive, then reconnect the same element when visible.
 */
export const useEditorRootLifecycle = (editor: IEditor) => {
  const disconnectObserverRef = useRef<MutationObserver | null>(null);
  const destroyedRef = useRef(false);
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

    return () => {
      const root = lexicalEditor.getRootElement();
      lexicalEditor.setRootElement(null);

      if (!root) return;
      inactiveEditorRef.current = { lexicalEditor, root };

      const destroyWhenDisconnected = () => {
        if (root.isConnected || destroyedRef.current) return;
        destroyedRef.current = true;
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

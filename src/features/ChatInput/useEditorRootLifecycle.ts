import type { IEditor } from '@lobehub/editor';
import { useEffect, useRef } from 'react';

/**
 * React Activity disconnects effects while preserving hidden DOM. Detach the
 * Lexical root while inactive, then reconnect the same element when visible.
 */
export const useEditorRootLifecycle = (editor: IEditor) => {
  const inactiveRootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const lexicalEditor = editor.getLexicalEditor();
    if (!lexicalEditor) return;

    if (inactiveRootRef.current) {
      lexicalEditor.setRootElement(inactiveRootRef.current);
      inactiveRootRef.current = null;
    }

    return () => {
      inactiveRootRef.current = lexicalEditor.getRootElement();
      lexicalEditor.setRootElement(null);
    };
  }, [editor]);
};

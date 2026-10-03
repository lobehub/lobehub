import type { IEditor } from '@lobehub/editor';
import { useEffect } from 'react';

type DocumentEditor = Pick<IEditor, 'setDocument'>;

const EDITOR_SYNC_DELAY = 100;

export const useEditorContentSync = (editor: DocumentEditor | undefined, content: string) => {
  useEffect(() => {
    if (!editor) return;

    const timer = setTimeout(() => {
      if (content) editor.setDocument('markdown', content);
    }, EDITOR_SYNC_DELAY);

    return () => clearTimeout(timer);
  }, [content, editor]);
};

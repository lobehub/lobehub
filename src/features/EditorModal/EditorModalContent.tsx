import { useEditor } from '@lobehub/editor/react';
import { memo, useEffect } from 'react';

import EditorCanvas from './EditorCanvas';
import type { EditorRef } from './type';

interface EditorModalContentProps {
  editorData?: unknown;
  editorRef: EditorRef;
  value?: string;
}

const EditorModalContent = memo<EditorModalContentProps>(({ editorData, editorRef, value }) => {
  const editor = useEditor();

  useEffect(() => {
    editorRef.current = editor;
  }, [editor, editorRef]);

  return <EditorCanvas defaultValue={value} editor={editor} editorData={editorData} />;
});

EditorModalContent.displayName = 'EditorModalContent';

export default EditorModalContent;

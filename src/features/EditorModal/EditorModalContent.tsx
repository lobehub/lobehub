import { useEditor } from '@lobehub/editor/react';
import { memo, useEffect } from 'react';

import EditorCanvas from './EditorCanvas';
import type { EditorBridge } from './type';

interface EditorModalContentProps {
  editorBridge: EditorBridge;
  editorData?: unknown;
  value?: string;
}

const EditorModalContent = memo<EditorModalContentProps>(({ editorBridge, editorData, value }) => {
  const editor = useEditor();

  useEffect(() => {
    editorBridge.current = editor;
    editorBridge.notifyReady?.();
  }, [editor, editorBridge]);

  return <EditorCanvas defaultValue={value} editor={editor} editorData={editorData} />;
});

EditorModalContent.displayName = 'EditorModalContent';

export default EditorModalContent;

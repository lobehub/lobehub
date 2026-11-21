'use client';

import { useEditor } from '@lobehub/editor/react';
import { type ComponentProps, memo, useMemo } from 'react';

import { EditorCanvas as SharedEditorCanvas } from '@/features/EditorCanvas';
import { useDocumentStore } from '@/store/document';

type RoomBodyPreviewProps = Pick<
  ComponentProps<typeof SharedEditorCanvas>,
  'allowContentBleed' | 'className' | 'enableInlineMath' | 'extraPlugins' | 'placeholder' | 'style'
> & { documentId: string };

// The stored body, read-only, while the room syncs. It runs on its own editor:
// writing the row into the room's editor would add a second copy of the page.
const RoomBodyPreview = memo<RoomBodyPreviewProps>(({ documentId, ...canvasProps }) => {
  const editor = useEditor();
  const content = useDocumentStore((s) => s.documents[documentId]?.content);
  const storedEditorData = useDocumentStore((s) => s.documents[documentId]?.editorData);
  const editorData = useMemo(
    () => ({ content: content ?? '', editorData: storedEditorData }),
    [content, storedEditorData],
  );

  return (
    <SharedEditorCanvas
      editable={false}
      editor={editor}
      editorData={editorData}
      entityId={documentId}
      floatingToolbar={false}
      {...canvasProps}
    />
  );
});

RoomBodyPreview.displayName = 'RoomBodyPreview';

export default RoomBodyPreview;

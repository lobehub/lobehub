'use client';

import { useEditor } from '@lobehub/editor/react';
import { memo } from 'react';

import { EditorCanvas as SharedEditorCanvas } from '@/features/EditorCanvas';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const EditorCanvas = memo(() => {
  const editor = useEditor();

  const documentId = useChatStore(chatPortalSelectors.portalDocumentId);

  return <SharedEditorCanvas documentId={documentId} editor={editor} sourceType="notebook" />;
});

export default EditorCanvas;

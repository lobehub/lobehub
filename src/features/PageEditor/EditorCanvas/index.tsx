'use client';

import { type CSSProperties, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { EditorCanvas as SharedEditorCanvas } from '@/features/EditorCanvas';
import { useDocumentStore } from '@/store/document';

import { usePageEditorStore } from '../store';
import { useAskCopilotItem } from './useAskCopilotItem';
import { useSlashItems } from './useSlashItems';

interface EditorCanvasProps {
  placeholder?: string;
  style?: CSSProperties;
}

const EditorCanvas = memo<EditorCanvasProps>(({ placeholder, style }) => {
  const { t } = useTranslation(['file', 'editor']);

  const editor = usePageEditorStore((s) => s.editor);
  const onEditorInit = usePageEditorStore((s) => s.onEditorInit);

  // Use global document store for content change handling
  const handleContentChange = useDocumentStore((s) => s.handleContentChange);

  const slashItems = useSlashItems(editor);
  const askCopilotItem = useAskCopilotItem(editor);

  return (
    <SharedEditorCanvas
      editor={editor}
      onContentChange={handleContentChange}
      onInit={onEditorInit}
      placeholder={placeholder || t('pageEditor.editorPlaceholder')}
      slashItems={slashItems}
      style={style}
      toolbarExtraItems={askCopilotItem}
    />
  );
});

export default EditorCanvas;

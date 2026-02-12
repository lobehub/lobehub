'use client';

import { type CSSProperties } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { EditorCanvas as SharedEditorCanvas } from '@/features/EditorCanvas';

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
  const documentId = usePageEditorStore((s) => s.documentId);

  const slashItems = useSlashItems(editor);
  const askCopilotItem = useAskCopilotItem(editor);

  return (
    <SharedEditorCanvas
      documentId={documentId}
      editor={editor}
      placeholder={placeholder || t('pageEditor.editorPlaceholder')}
      slashItems={slashItems}
      style={style}
      toolbarExtraItems={askCopilotItem}
    />
  );
});

export default EditorCanvas;

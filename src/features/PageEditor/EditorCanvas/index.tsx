'use client';

import { ReactBlockPlugin } from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { type CSSProperties, useMemo } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ComposerTarget } from '@/features/Conversation/types';
import { EditorCanvas as SharedEditorCanvas } from '@/features/EditorCanvas';

import { usePageEditorStore } from '../store';
import { usePageEditable } from '../usePageEditable';
import { useAskCopilotItem } from './useAskCopilotItem';
import { useSlashItems } from './useSlashItems';

interface EditorCanvasProps {
  askCopilotTarget?: ComposerTarget;
  placeholder?: string;
  style?: CSSProperties;
}

const EditorCanvas = memo<EditorCanvasProps>(({ askCopilotTarget, placeholder, style }) => {
  const { t } = useTranslation(['file', 'ui']);
  const editable = usePageEditable();

  const editor = usePageEditorStore((s) => s.editor);
  const documentId = usePageEditorStore((s) => s.documentId);

  const slashItems = useSlashItems();
  const askCopilotItem = useAskCopilotItem(editor, askCopilotTarget);

  const extraPlugins = useMemo(
    () => [Editor.withProps(ReactBlockPlugin, { anchorPadding: 0 })],
    [],
  );

  return (
    <SharedEditorCanvas
      documentId={documentId}
      editable={editable}
      editor={editor}
      extraPlugins={extraPlugins}
      placeholder={placeholder || t('pageEditor.editorPlaceholder')}
      slashItems={slashItems}
      style={style}
      toolbarExtraItems={editable ? askCopilotItem : undefined}
      unsavedChangesGuard={{
        enabled: true,
        message: t('form.unsavedWarning', { ns: 'ui' }),
        title: t('form.unsavedChanges', { ns: 'ui' }),
      }}
    />
  );
});

export default EditorCanvas;

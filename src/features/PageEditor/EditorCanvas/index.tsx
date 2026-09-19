'use client';

import { ReactBlockPlugin } from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { type CSSProperties, useMemo } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { mentionFilledClassName } from '@/features/ChatInput/InputEditor/mentionStyle';
import type { ComposerTarget } from '@/features/Conversation/types';
import { EditorCanvas as SharedEditorCanvas } from '@/features/EditorCanvas';

import { usePageEditorStore } from '../store';
import { usePageEditable } from '../usePageEditable';
import { useAddCommentItem } from './useAddCommentItem';
import { useAskCopilotItem } from './useAskCopilotItem';
import { useDocumentMentionOption } from './useDocumentMentionOption';
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
  const addCommentItem = useAddCommentItem(editor, documentId);
  const mentionOption = useDocumentMentionOption();
  const toolbarExtraItems = useMemo(
    () => [...(askCopilotItem ?? []), ...(addCommentItem ?? [])],
    [addCommentItem, askCopilotItem],
  );

  const extraPlugins = useMemo(
    () => [Editor.withProps(ReactBlockPlugin, { anchorPadding: 0 })],
    [],
  );

  return (
    <SharedEditorCanvas
      className={mentionFilledClassName}
      documentId={documentId}
      editable={editable}
      editor={editor}
      extraPlugins={extraPlugins}
      mentionOption={mentionOption}
      placeholder={placeholder || t('pageEditor.editorPlaceholder')}
      // Commenting on a selection is a read action: it must survive the page
      // being locked by another collaborator or opened view-only, when the
      // formatting toolbar (and Ask Copilot with it) is withheld.
      readonlySelectionItems={editable ? undefined : addCommentItem}
      slashItems={slashItems}
      style={style}
      toolbarExtraItems={editable ? toolbarExtraItems : undefined}
      unsavedChangesGuard={{
        enabled: true,
        message: t('form.unsavedWarning', { ns: 'ui' }),
        title: t('form.unsavedChanges', { ns: 'ui' }),
      }}
    />
  );
});

export default EditorCanvas;

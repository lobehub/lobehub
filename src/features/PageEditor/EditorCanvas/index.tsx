'use client';

import { ReactBlockPlugin, ReactCollapsiblePlugin } from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { type CSSProperties, useMemo } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { mentionPlainClassName } from '@/features/ChatInput/InputEditor/mentionStyle';
import type { ComposerTarget } from '@/features/Conversation/types';
import { EditorCanvas as SharedEditorCanvas } from '@/features/EditorCanvas';

import { usePageCollab } from '../collab/usePageCollab';
import { usePageEditorStore } from '../store';
import { usePageEditable } from '../usePageEditable';
import RoomBodyPreview from './RoomBodyPreview';
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
  const onCollabReset = usePageEditorStore((s) => s.onCollabReset);
  const collabPlugin = usePageCollab(documentId, onCollabReset);
  const collabConnecting = usePageEditorStore((s) => s.collab?.status === 'connecting');

  const slashItems = useSlashItems();
  const askCopilotItem = useAskCopilotItem(editor, askCopilotTarget);
  const addCommentItem = useAddCommentItem(editor, documentId);
  const mentionOption = useDocumentMentionOption();
  const toolbarExtraItems = useMemo(
    () => [...(askCopilotItem ?? []), ...(addCommentItem ?? [])],
    [addCommentItem, askCopilotItem],
  );

  const basePlugins = useMemo(
    () => [Editor.withProps(ReactBlockPlugin, { anchorPadding: 0 }), ReactCollapsiblePlugin],
    [],
  );
  const extraPlugins = useMemo(
    () => (collabPlugin ? [...basePlugins, collabPlugin] : basePlugins),
    [basePlugins, collabPlugin],
  );
  const resolvedPlaceholder = placeholder || t('pageEditor.editorPlaceholder');
  const showStoredBody = !!collabPlugin && collabConnecting && !!documentId;
  const pendingBody = useMemo(
    () =>
      showStoredBody ? (
        <RoomBodyPreview
          allowContentBleed
          className={mentionPlainClassName}
          documentId={documentId!}
          enableInlineMath={false}
          extraPlugins={basePlugins}
          placeholder={resolvedPlaceholder}
          style={style}
        />
      ) : undefined,
    [basePlugins, documentId, resolvedPlaceholder, showStoredBody, style],
  );

  return (
    <SharedEditorCanvas
      allowContentBleed
      className={mentionPlainClassName}
      collab={!!collabPlugin}
      documentId={documentId}
      editable={editable}
      editor={editor}
      enableInlineMath={false}
      extraPlugins={extraPlugins}
      mentionOption={mentionOption}
      pendingBody={pendingBody}
      placeholder={resolvedPlaceholder}
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

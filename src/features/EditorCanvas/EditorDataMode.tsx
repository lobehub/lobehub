'use client';

import { type IEditor } from '@lobehub/editor';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { EMPTY_EDITOR_STATE } from '@/libs/editor/constants';

import { type EditorCanvasProps } from './EditorCanvas';
import InternalEditor from './InternalEditor';

export interface EditorDataModeProps extends EditorCanvasProps {
  editor: IEditor | undefined;
  editorData: NonNullable<EditorCanvasProps['editorData']>;
  entityId?: string;
}

const loadEditorContent = (
  editorInstance: IEditor,
  editorData: EditorDataModeProps['editorData'],
): boolean => {
  const hasValidEditorData =
    editorData.editorData &&
    typeof editorData.editorData === 'object' &&
    Object.keys(editorData.editorData as object).length > 0;

  try {
    if (hasValidEditorData) {
      editorInstance.setDocument('json', JSON.stringify(editorData.editorData));
      return true;
    } else if (editorData.content?.trim()) {
      editorInstance.setDocument('markdown', editorData.content, { keepId: true });
      return true;
    } else {
      editorInstance.setDocument('json', JSON.stringify(EMPTY_EDITOR_STATE));
      return true;
    }
  } catch (err) {
    console.error('[loadEditorContent] Error loading content:', err);
    return false;
  }
};

/**
 * EditorCanvas with editorData mode - uses provided data directly
 */
const EditorDataMode = memo<EditorDataModeProps>(
  ({
    contentRevision,
    editor,
    editorData,
    entityId,
    onContentChange,
    onInit,
    style,
    ...editorProps
  }) => {
    const { t } = useTranslation('file');
    const isEditorReadyRef = useRef(false);
    const contentChangeLockRef = useRef(false);
    const lockIdRef = useRef(0);
    // Track the current entityId to detect entity changes
    const currentEntityIdRef = useRef<string | undefined>(undefined);
    const currentContentRevisionRef = useRef<number | undefined>(undefined);

    // Check if we're editing a different entity
    // When entityId is undefined, always consider it as "changed" (backward compatibility)
    // When entityId is provided, check if it actually changed
    const isEntityChanged = entityId === undefined || currentEntityIdRef.current !== entityId;
    const isContentRevisionChanged = currentContentRevisionRef.current !== contentRevision;
    const shouldReloadContent = isEntityChanged || isContentRevisionChanged;

    const loadContentWithLock = useCallback(
      (editorInstance: IEditor) => {
        const lockId = ++lockIdRef.current;
        contentChangeLockRef.current = true;
        if (loadEditorContent(editorInstance, editorData)) {
          currentEntityIdRef.current = entityId;
          currentContentRevisionRef.current = contentRevision;
        }
        queueMicrotask(() => {
          if (lockIdRef.current === lockId) {
            contentChangeLockRef.current = false;
          }
        });
      },
      [contentRevision, editorData, entityId],
    );

    const handleInit = useCallback(
      (editorInstance: IEditor) => {
        isEditorReadyRef.current = true;
        if (shouldReloadContent) loadContentWithLock(editorInstance);
        onInit?.(editorInstance);
      },
      [loadContentWithLock, onInit, shouldReloadContent],
    );

    // Reload only for an entity switch or an explicit authoritative revision.
    // editorData object churn and local autosave echoes keep the revision stable,
    // so they cannot overwrite live input or reset the cursor.
    useEffect(() => {
      if (!editor || !isEditorReadyRef.current || !shouldReloadContent) return;
      loadContentWithLock(editor);
    }, [editor, loadContentWithLock, shouldReloadContent]);

    if (!editor) return null;

    return (
      <div style={{ position: 'relative', ...style }}>
        <InternalEditor
          contentChangeLockRef={contentChangeLockRef}
          editor={editor}
          placeholder={editorProps.placeholder || t('pageEditor.editorPlaceholder')}
          onContentChange={onContentChange}
          onInit={handleInit}
          {...editorProps}
        />
      </div>
    );
  },
);

EditorDataMode.displayName = 'EditorDataMode';

export default EditorDataMode;

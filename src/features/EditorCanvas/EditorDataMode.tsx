'use client';

import { type IEditor } from '@lobehub/editor';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

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
    }
  } catch (err) {
    console.error('[loadEditorContent] Error loading content:', err);
    return false;
  }

  return false;
};

/**
 * EditorCanvas with editorData mode - uses provided data directly
 */
const EditorDataMode = memo<EditorDataModeProps>(
  ({ editor, editorData, entityId, onContentChange, onInit, style, ...editorProps }) => {
    const { t } = useTranslation('file');
    const isEditorReadyRef = useRef(false);
    // Track the current entityId to detect entity changes
    const currentEntityIdRef = useRef<string | undefined>(undefined);

    // Check if we're editing a different entity
    // When entityId is undefined, always consider it as "changed" (backward compatibility)
    // When entityId is provided, check if it actually changed
    const isEntityChanged = entityId === undefined || currentEntityIdRef.current !== entityId;

    const handleInit = useCallback(
      (editorInstance: IEditor) => {
        isEditorReadyRef.current = true;

        // Always load content on init
        try {
          if (isEntityChanged && loadEditorContent(editorInstance, editorData)) {
            currentEntityIdRef.current = entityId;
          }
        } catch (err) {
          console.error('[EditorCanvas] Failed to load content:', err);
        }

        onInit?.(editorInstance);
      },
      [editorData, entityId, onInit],
    );

    // Load content when entityId changes (switching to a different entity)
    // Ignore editorData changes when entityId hasn't changed to prevent focus loss during auto-save
    useEffect(() => {
      if (!editor || !isEditorReadyRef.current) return;

      // Only reload if entityId changed
      if (!isEntityChanged) {
        // Same entity - don't reload, user is still editing
        return;
      }

      // Different entity - load new content
      try {
        if (loadEditorContent(editor, editorData)) {
          currentEntityIdRef.current = entityId;
        }
      } catch (err) {
        console.error('[EditorCanvas] Failed to load content:', err);
      }
    }, [editor, entityId, editorData, isEntityChanged]);

    if (!editor) return null;

    return (
      <div style={{ position: 'relative', ...style }}>
        <InternalEditor
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

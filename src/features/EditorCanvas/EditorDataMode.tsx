'use client';

import { type IEditor } from '@lobehub/editor';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { EditorCanvasProps } from './EditorCanvas';
import InternalEditor from './InternalEditor';

export interface EditorDataModeProps extends EditorCanvasProps {
  editor: IEditor | undefined;
  editorData: NonNullable<EditorCanvasProps['editorData']>;
}

const loadEditorContent = (
  editorInstance: IEditor,
  editorData: EditorDataModeProps['editorData'],
): boolean => {
  const hasValidEditorData =
    editorData.editorData &&
    typeof editorData.editorData === 'object' &&
    Object.keys(editorData.editorData as object).length > 0;

  if (hasValidEditorData) {
    editorInstance.setDocument('json', JSON.stringify(editorData.editorData));
    return true;
  } else if (editorData.content?.trim()) {
    editorInstance.setDocument('markdown', editorData.content, { keepId: true });
    return true;
  }
  return false;
};

/**
 * EditorCanvas with editorData mode - uses provided data directly
 */
const EditorDataMode = memo<EditorDataModeProps>(
  ({ editor, editorData, onContentChange, onInit, style, ...editorProps }) => {
    const { t } = useTranslation('file');
    const isEditorReadyRef = useRef(false);
    // Track loaded content to support re-loading when data changes
    const loadedContentRef = useRef<string | undefined>(undefined);

    // Check if content has actually changed
    const hasDataChanged = loadedContentRef.current !== editorData.content;

    const handleInit = useCallback(
      (editorInstance: IEditor) => {
        isEditorReadyRef.current = true;

        // Try to load content if editorData is available and hasn't been loaded yet
        if (hasDataChanged) {
          try {
            if (loadEditorContent(editorInstance, editorData)) {
              loadedContentRef.current = editorData.content;
            }
          } catch (err) {
            console.error('[EditorCanvas] Failed to load content:', err);
          }
        }

        onInit?.(editorInstance);
      },
      [editorData, hasDataChanged, onInit],
    );

    // Load content when editorData changes after editor is ready
    useEffect(() => {
      if (!editor || !isEditorReadyRef.current || !hasDataChanged) return;

      try {
        if (loadEditorContent(editor, editorData)) {
          loadedContentRef.current = editorData.content;
        }
      } catch (err) {
        console.error('[EditorCanvas] Failed to load content:', err);
      }
    }, [editor, editorData, hasDataChanged]);

    if (!editor) return null;

    return (
      <div style={{ position: 'relative', ...style }}>
        <InternalEditor
          editor={editor}
          onContentChange={onContentChange}
          onInit={handleInit}
          placeholder={editorProps.placeholder || t('pageEditor.editorPlaceholder')}
          {...editorProps}
        />
      </div>
    );
  },
);

EditorDataMode.displayName = 'EditorDataMode';

export default EditorDataMode;

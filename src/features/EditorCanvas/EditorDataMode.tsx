'use client';

import { type IEditor } from '@lobehub/editor';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EditorCanvasProps } from './EditorCanvas';
import InternalEditor from './InternalEditor';

export interface EditorDataModeProps extends EditorCanvasProps {
  editor: IEditor | undefined;
  editorData: NonNullable<EditorCanvasProps['editorData']>;
}

/**
 * EditorCanvas with editorData mode - uses provided data directly
 */
const EditorDataMode = memo<EditorDataModeProps>(
  ({ editor, editorData, onContentChange, style, ...editorProps }) => {
    const { t } = useTranslation('file');
    const [isInitialized, setIsInitialized] = useState(false);

    // Load content into editor on mount
    useEffect(() => {
      if (!editor || isInitialized) return;

      const hasValidEditorData =
        editorData.editorData &&
        typeof editorData.editorData === 'object' &&
        Object.keys(editorData.editorData as object).length > 0;

      try {
        if (hasValidEditorData) {
          editor.setDocument('json', JSON.stringify(editorData.editorData));
        } else if (editorData.content?.trim()) {
          editor.setDocument('markdown', editorData.content, { keepId: true });
        } else {
          console.error('[EditorCanvas] load content error:', editorData);
        }

        setIsInitialized(true);
      } catch (err) {
        console.error('[EditorCanvas] Failed to load content:', err);
      }
    }, [editorData, editor, isInitialized]);

    if (!editor) return null;

    return (
      <div style={{ position: 'relative', ...style }}>
        <InternalEditor
          editor={editor}
          onContentChange={onContentChange}
          placeholder={editorProps.placeholder || t('pageEditor.editorPlaceholder')}
          {...editorProps}
        />
      </div>
    );
  },
);

EditorDataMode.displayName = 'EditorDataMode';

export default EditorDataMode;

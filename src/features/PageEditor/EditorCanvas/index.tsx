'use client';

import {
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  ReactImagePlugin,
  ReactLinkPlugin,
  ReactListPlugin,
  ReactLiteXmlPlugin,
  ReactMathPlugin,
  ReactTablePlugin,
  ReactToolbarPlugin,
} from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { type CSSProperties, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePageEditorStore } from '../store';
import InlineToolbar from './InlineToolbar';
import { useSlashItems } from './useSlashItems';

interface EditorCanvasProps {
  placeholder?: string;
  style?: CSSProperties;
}

const EditorCanvas = memo<EditorCanvasProps>(({ placeholder, style }) => {
  const { t } = useTranslation(['file', 'editor']);

  const editor = usePageEditorStore((s) => s.editor);
  const handleContentChange = usePageEditorStore((s) => s.handleContentChange);
  const onEditorInit = usePageEditorStore((s) => s.onEditorInit);

  const slashItems = useSlashItems(editor);

  if (!editor) return null;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <Editor
        content={''}
        editor={editor!}
        lineEmptyPlaceholder={placeholder || t('pageEditor.editorPlaceholder')}
        onInit={onEditorInit}
        onTextChange={handleContentChange}
        placeholder={placeholder || t('pageEditor.editorPlaceholder')}
        plugins={[
          ReactLiteXmlPlugin,
          ReactListPlugin,
          ReactCodePlugin,
          ReactCodemirrorPlugin,
          ReactHRPlugin,
          ReactLinkPlugin,
          ReactTablePlugin,
          ReactMathPlugin,
          Editor.withProps(ReactImagePlugin, {
            defaultBlockImage: true,
          }),
          Editor.withProps(ReactToolbarPlugin, {
            children: <InlineToolbar floating />,
          }),
        ]}
        slashOption={{
          items: slashItems,
        }}
        style={{
          paddingBottom: 64,
          ...style,
        }}
        type={'text'}
      />
    </div>
  );
});

export default EditorCanvas;

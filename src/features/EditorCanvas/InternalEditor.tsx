'use client';

import {
  type IEditor,
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
import { Editor, useEditorState } from '@lobehub/editor/react';
import { memo, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { EditorCanvasProps } from './EditorCanvas';
import InlineToolbar from './InlineToolbar';

/**
 * Base plugins for the editor (without toolbar)
 */
const BASE_PLUGINS = [
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
];

export interface InternalEditorProps extends EditorCanvasProps {
  /**
   * Editor instance (required)
   */
  editor: IEditor;
}

/**
 * Internal EditorCanvas component that requires editor instance
 */
const InternalEditor = memo<InternalEditorProps>(
  ({
    editor,
    extraPlugins,
    floatingToolbar = true,
    onContentChange,
    onInit,
    placeholder,
    plugins: customPlugins,
    slashItems,
    style,
    toolbarExtraItems,
  }) => {
    const { t } = useTranslation('file');
    const editorState = useEditorState(editor);

    const finalPlaceholder = placeholder || t('pageEditor.editorPlaceholder');

    // Build plugins array
    const plugins = useMemo(() => {
      // If custom plugins provided, use them directly
      if (customPlugins) return customPlugins;

      // Build base plugins with optional extra plugins prepended
      const basePlugins = extraPlugins ? [...extraPlugins, ...BASE_PLUGINS] : BASE_PLUGINS;

      // Add toolbar if enabled
      if (floatingToolbar) {
        return [
          ...basePlugins,
          Editor.withProps(ReactToolbarPlugin, {
            children: (
              <InlineToolbar
                editor={editor}
                editorState={editorState}
                extraItems={toolbarExtraItems}
                floating
              />
            ),
          }),
        ];
      }

      return basePlugins;
    }, [customPlugins, editor, editorState, extraPlugins, floatingToolbar, toolbarExtraItems]);

    useEffect(() => {
      // for easier debug, mount editor instance to window
      if (editor) window.__editor = editor;

      return () => {
        window.__editor = undefined;
      };
    }, [editor]);

    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <Editor
          content={''}
          editor={editor}
          lineEmptyPlaceholder={finalPlaceholder}
          onInit={onInit}
          onTextChange={onContentChange}
          placeholder={finalPlaceholder}
          plugins={plugins}
          slashOption={slashItems ? { items: slashItems } : undefined}
          style={{
            paddingBottom: 64,
            ...style,
          }}
          type={'text'}
        />
      </div>
    );
  },
);

InternalEditor.displayName = 'InternalEditor';

export default InternalEditor;

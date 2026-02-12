'use client';

import type { IEditor } from '@lobehub/editor';
import {
  ReactCodemirrorPlugin,
  ReactCodePlugin,
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
import { memo, useEffect, useMemo, useRef } from 'react';
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
                floating
                editor={editor}
                editorState={editorState}
                extraItems={toolbarExtraItems}
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

    // Use refs for stable references across re-renders
    const previousContentRef = useRef<string | undefined>(undefined);
    const onContentChangeRef = useRef(onContentChange);
    onContentChangeRef.current = onContentChange;

    // Listen to Lexical updates directly to trigger content change
    // This bypasses @lobehub/editor's onTextChange which has issues with previousContent reset
    useEffect(() => {
      if (!editor) return;

      const lexicalEditor = editor.getLexicalEditor?.();
      if (!lexicalEditor) return;

      // Initialize previousContent with current content before registering listener
      previousContentRef.current = JSON.stringify(editor.getDocument('text'));

      const unregister = lexicalEditor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
        // Only process when there are actual content changes
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;

        const currentContent = JSON.stringify(editor.getDocument('text'));

        if (currentContent !== previousContentRef.current) {
          // Content actually changed
          previousContentRef.current = currentContent;
          onContentChangeRef.current?.();
        }
      });

      return () => {
        unregister();
      };
    }, [editor]); // Only depend on editor, use ref for onContentChange

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
          placeholder={finalPlaceholder}
          plugins={plugins}
          slashOption={slashItems ? { items: slashItems } : undefined}
          type={'text'}
          style={{
            paddingBottom: 64,
            ...style,
          }}
          onInit={onInit}
        />
      </div>
    );
  },
);

InternalEditor.displayName = 'InternalEditor';

export default InternalEditor;

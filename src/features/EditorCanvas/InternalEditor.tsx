'use client';

import { isDesktop } from '@lobechat/const';
import { type IEditor } from '@lobehub/editor';
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
import isEqual from 'fast-deep-equal';
import { memo, type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { type EditorCanvasProps } from './EditorCanvas';
import InlineToolbar from './InlineToolbar';
import { useImageUpload } from './useImageUpload';

const IMAGE_FILTERS = [
  { extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'], name: 'Images' },
];

/**
 * Base plugins for the editor (without image and toolbar, which need dynamic config)
 */
const STATIC_PLUGINS = [
  ReactLiteXmlPlugin,
  ReactListPlugin,
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  ReactLinkPlugin,
  ReactTablePlugin,
  ReactMathPlugin,
];

export interface InternalEditorProps extends EditorCanvasProps {
  /**
   * Optional lock ref to suppress content-change callback during programmatic document hydration.
   */
  contentChangeLockRef?: RefObject<boolean>;

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
    contentChangeLockRef,
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
    const handleImageUpload = useImageUpload();

    const handlePickFile = useCallback(async (): Promise<File | null> => {
      if (!isDesktop) return null;
      const { ensureElectronIpc } = await import('@/utils/electron/ipc');
      const ipc = ensureElectronIpc();
      const result = await (ipc as any).localSystem.handlePickFile({
        filters: IMAGE_FILTERS,
      });
      if (result.canceled || !result.file) return null;
      const { data, mimeType, name } = result.file;
      return new File([data], name, { type: mimeType });
    }, []);

    const finalPlaceholder = placeholder || t('pageEditor.editorPlaceholder');

    // Build plugins array
    const plugins = useMemo(() => {
      // If custom plugins provided, use them directly
      if (customPlugins) return customPlugins;

      const imagePlugin = Editor.withProps(ReactImagePlugin, {
        defaultBlockImage: true,
        handleUpload: handleImageUpload,
        onPickFile: isDesktop ? handlePickFile : undefined,
      });

      // Build base plugins with optional extra plugins prepended
      const basePlugins = extraPlugins
        ? [...extraPlugins, ...STATIC_PLUGINS, imagePlugin]
        : [...STATIC_PLUGINS, imagePlugin];

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
    }, [
      customPlugins,
      editor,
      editorState,
      extraPlugins,
      floatingToolbar,
      handleImageUpload,
      handlePickFile,
      toolbarExtraItems,
    ]);

    useEffect(() => {
      // for easier debug, mount editor instance to window
      if (editor) window.__editor = editor;

      return () => {
        window.__editor = undefined;
      };
    }, [editor]);

    // Use refs for stable references across re-renders
    const previousDocumentSnapshotRef = useRef<unknown>(undefined);
    const onContentChangeRef = useRef(onContentChange);
    onContentChangeRef.current = onContentChange;

    // Listen to Lexical updates directly to trigger content change
    // This bypasses @lobehub/editor's onTextChange which has issues with previousContent reset
    useEffect(() => {
      if (!editor) return;

      const lexicalEditor = editor.getLexicalEditor?.();
      if (!lexicalEditor) return;

      // Initialize snapshot before registering listener
      previousDocumentSnapshotRef.current = editor.getDocument('json');

      const unregister = lexicalEditor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
        // Skip selection-only / caret-movement updates — no content was mutated.
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;

        const currentDocumentSnapshot = editor.getDocument('json');

        if (!isEqual(currentDocumentSnapshot, previousDocumentSnapshotRef.current)) {
          previousDocumentSnapshotRef.current = currentDocumentSnapshot;

          // During document hydration (e.g. route switch), we only advance snapshot
          // and skip external change callback to avoid false dirty checks.
          if (contentChangeLockRef?.current) return;

          onContentChangeRef.current?.();
        }
      });

      return () => {
        unregister();
      };
    }, [contentChangeLockRef, editor]); // Only depend on stable refs and editor

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

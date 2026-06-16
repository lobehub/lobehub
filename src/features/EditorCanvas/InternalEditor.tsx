'use client';

import { isDesktop } from '@lobechat/const';
import type { IEditor } from '@lobehub/editor';
import {
  ReactImagePlugin,
  ReactLinkPlugin,
  ReactLiteXmlPlugin,
  ReactTablePlugin,
  ReactToolbarPlugin,
} from '@lobehub/editor';
import { Editor, useEditorState } from '@lobehub/editor/react';
import { createStaticStyles } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { memo, type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { createChatInputRichPlugins } from '@/features/ChatInput/InputEditor/plugins';

import { type EditorCanvasProps } from './EditorCanvas';
import InlineToolbar from './InlineToolbar';
import LinearFilePlugin from './LinearFilePlugin';
import { registerAttachmentClickOpen } from './registerAttachmentClickOpen';
import { useFileUpload, useImageUpload } from './useImageUpload';

const IMAGE_FILTERS = [
  { extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'], name: 'Images' },
];

// Force the Lexical FileNode's outer `<span>` to render as its own block-
// level row inside the paragraph. The inner card visuals (icon + name + size
// + download button) live in `LinearFilePlugin`.
const fileNodeStyles = createStaticStyles(({ css }) => ({
  fileWrapper: css`
    display: block !important;
    width: 100% !important;
    margin-block: 8px !important;
  `,
}));

/**
 * Base plugins for the editor (without image and toolbar, which need dynamic config)
 */
const STATIC_PLUGINS = [
  ReactLiteXmlPlugin,
  ...createChatInputRichPlugins({ linkPlugin: ReactLinkPlugin }),
  ReactTablePlugin,
];

const EDITOR_INIT_DATA_SOURCE_TYPES = ['json', 'markdown'] as const;
const EDITOR_INIT_RETRY_LIMIT = 30;
const EDITOR_INIT_RETRY_INTERVAL = 16;

interface InspectableEditor extends IEditor {
  dataTypeMap?: Map<string, unknown> | Record<string, unknown>;
}

const getEditorDataSourceTypes = (editor: InspectableEditor): string[] => {
  const dataTypeMap = editor.dataTypeMap;

  if (!dataTypeMap) return [];

  if (dataTypeMap instanceof Map) {
    return [...dataTypeMap.keys()].sort();
  }

  return Object.keys(dataTypeMap).sort();
};

const isEditorInitReady = (editor: IEditor) => {
  const inspectableEditor = editor as InspectableEditor;
  const dataSourceTypes = getEditorDataSourceTypes(inspectableEditor);

  return {
    dataSourceTypes,
    hasLexicalEditor: !!editor.getLexicalEditor?.(),
    isReady:
      !!editor.getLexicalEditor?.() &&
      EDITOR_INIT_DATA_SOURCE_TYPES.every((type) => dataSourceTypes.includes(type)),
  };
};

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
    disabled,
    editable = true,
    editor,
    extraPlugins,
    floatingToolbar = true,
    onContentChange,
    onInit,
    onPressEnter,
    placeholder,
    plugins: customPlugins,
    slashItems,
    style,
    toolbarExtraItems,
  }) => {
    const { t } = useTranslation('file');
    const editorState = useEditorState(editor);
    const handleImageUpload = useImageUpload();
    const handleFileUpload = useFileUpload();

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

      const filePlugin = Editor.withProps(LinearFilePlugin, {
        handleUpload: handleFileUpload,
        theme: { file: fileNodeStyles.fileWrapper as unknown as string },
      });

      // Build base plugins with optional extra plugins prepended
      const basePlugins = extraPlugins
        ? [...extraPlugins, ...STATIC_PLUGINS, imagePlugin, filePlugin]
        : [...STATIC_PLUGINS, imagePlugin, filePlugin];

      // Add toolbar only when the editor is actually editable — a locked /
      // read-only page must not surface the floating formatting toolbar on
      // text selection (its buttons would dispatch commands that never save).
      if (floatingToolbar && editable && !disabled) {
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
      disabled,
      editable,
      editor,
      editorState,
      extraPlugins,
      floatingToolbar,
      handleFileUpload,
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

    // Open file attachments in a new tab on click (PDFs preview natively).
    // Workaround for @lobehub/editor's ReactFile decorator not exposing a
    // download / preview affordance.
    useEffect(() => {
      if (!editor) return;
      const unregister = registerAttachmentClickOpen(editor);
      return () => unregister?.();
    }, [editor]);

    const onInitRef = useRef(onInit);
    const initializedEditorRef = useRef<IEditor | null>(null);

    useEffect(() => {
      onInitRef.current = onInit;
    }, [onInit]);

    useEffect(() => {
      if (!onInit) return;

      let retryCount = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let disposed = false;

      const notifyWhenReady = () => {
        if (disposed) return;

        const snapshot = isEditorInitReady(editor);

        if (snapshot.isReady) {
          if (initializedEditorRef.current !== editor) {
            initializedEditorRef.current = editor;
            onInitRef.current?.(editor);
          }

          return;
        }

        if (retryCount >= EDITOR_INIT_RETRY_LIMIT) {
          console.warn('[InternalEditor] onInit delayed because editor is not ready:', snapshot);
          return;
        }

        retryCount += 1;
        timer = setTimeout(notifyWhenReady, EDITOR_INIT_RETRY_INTERVAL);
      };

      notifyWhenReady();

      return () => {
        disposed = true;
        if (timer) clearTimeout(timer);
      };
    }, [editor, onInit]);

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
          if (disabled) return;

          onContentChangeRef.current?.();
        }
      });

      return () => {
        unregister();
      };
    }, [contentChangeLockRef, disabled, editor]); // Only depend on stable refs and editor

    return (
      <div
        style={
          disabled ? { cursor: 'not-allowed', opacity: 0.65, pointerEvents: 'none' } : undefined
        }
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <Editor
          content={''}
          editable={editable && !disabled}
          editor={editor}
          placeholder={finalPlaceholder}
          plugins={plugins}
          slashOption={slashItems ? { items: slashItems } : undefined}
          type={'text'}
          style={{
            paddingBottom: 32,
            ...style,
          }}
          {...(onPressEnter ? { onPressEnter } : {})}
        />
      </div>
    );
  },
);

InternalEditor.displayName = 'InternalEditor';

export default InternalEditor;

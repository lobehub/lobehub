'use client';

import { isDesktop } from '@lobechat/const';
import type { IEditor } from '@lobehub/editor';
import {
  ReactImagePlugin,
  ReactLinkPlugin,
  ReactLiteXmlPlugin,
  ReactMentionPlugin,
  ReactTablePlugin,
  ReactToolbarPlugin,
} from '@lobehub/editor';
import { Editor, useEditorState } from '@lobehub/editor/react';
import { createStaticStyles } from 'antd-style';
import type { CSSProperties, RefObject } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { createChatInputRichPlugins } from '@/features/ChatInput/InputEditor/plugins';
import { writeTopicCommentMentionMarkdown } from '@/features/Portal/TopicComments/editorUtils';
import { useEditorDocumentChange } from '@/hooks/useEditorDocumentChange';

import { type EditorCanvasProps } from './EditorCanvas';
import InlineToolbar from './InlineToolbar';
import LinearFilePlugin from './LinearFilePlugin';
import { registerAttachmentClickOpen } from './registerAttachmentClickOpen';
import { registerBlockDecoratorCaretGuard } from './registerBlockDecoratorCaretGuard';
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
  // The kernel reads a plugin's config once at init, and `mentionOption` can
  // arrive later (workspace pages resolve their member source asynchronously),
  // so pin the member chip's markdown form here rather than relying on
  // `mentionOption.markdownWriter` being present at mount. Same writer as the
  // comment editors, so a chip serialises identically in every canvas.
  Editor.withProps(ReactMentionPlugin, { markdownWriter: writeTopicCommentMentionMarkdown }),
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
    blockImageCaretGuard = false,
    className,
    contentChangeLockRef,
    contentStyle,
    disabled,
    editable = true,
    editor,
    extraPlugins,
    floatingToolbar = true,
    getPopupContainer,
    mentionOption,
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
    const wrapperStyle = useMemo<CSSProperties>(
      () => ({
        cursor: disabled ? 'not-allowed' : undefined,
        maxWidth: '100%',
        minWidth: 0,
        opacity: disabled ? 0.65 : undefined,
        overflow: 'hidden',
        pointerEvents: disabled ? 'none' : undefined,
        width: '100%',
      }),
      [disabled],
    );

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

    // Opt-in (comment editors): keep the caret out of the root node around
    // block images by pushing an empty paragraph next to the image instead of
    // showing Lexical's horizontal root-level caret.
    useEffect(() => {
      if (!editor || !blockImageCaretGuard) return;
      const unregister = registerBlockDecoratorCaretGuard(editor);
      return () => unregister?.();
    }, [blockImageCaretGuard, editor]);

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

    useEditorDocumentChange({
      contentChangeLockRef,
      disabled,
      editor,
      onContentChange: () => onContentChange?.(),
    });

    return (
      <div
        className={className}
        style={wrapperStyle}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <Editor
          content={''}
          editable={editable && !disabled}
          editor={editor}
          getPopupContainer={getPopupContainer}
          mentionOption={mentionOption}
          placeholder={finalPlaceholder}
          plugins={plugins}
          slashOption={slashItems ? { items: slashItems } : undefined}
          type={'text'}
          style={{
            paddingBottom: 32,
            ...style,
            ...contentStyle,
          }}
          {...(onPressEnter ? { onPressEnter } : {})}
        />
      </div>
    );
  },
);

InternalEditor.displayName = 'InternalEditor';

export default InternalEditor;

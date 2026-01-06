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
import { Alert } from '@lobehub/ui';
import { type CSSProperties, Component, type ErrorInfo, type ReactNode, memo } from 'react';
import { useTranslation } from 'react-i18next';

import { usePageEditorStore } from '../store';
import InlineToolbar from './InlineToolbar';
import { useSlashItems } from './useSlashItems';

interface EditorErrorBoundaryState {
  error: Error | null;
  hasError: boolean;
}

/**
 * ErrorBoundary for EditorCanvas component.
 * Catches rendering errors in the editor and displays a fallback error UI
 * instead of crashing the entire page.
 */
class EditorErrorBoundary extends Component<{ children: ReactNode }, EditorErrorBoundaryState> {
  public state: EditorErrorBoundaryState = {
    error: null,
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<EditorErrorBoundaryState> {
    return { error, hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[EditorErrorBoundary] Caught error in editor render:', {
      componentStack: errorInfo.componentStack,
      error: error.message,
      stack: error.stack,
    });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <Alert
          message={this.state.error?.message || 'An unknown error occurred in the editor'}
          showIcon
          style={{
            margin: 16,
            overflow: 'hidden',
            position: 'relative',
            width: '100%',
          }}
          title="Editor Error"
          type="error"
        />
      );
    }

    return this.props.children;
  }
}

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
    <EditorErrorBoundary>
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
    </EditorErrorBoundary>
  );
});

export default EditorCanvas;

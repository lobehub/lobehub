'use client';

import { type IEditor, type SlashOptions } from '@lobehub/editor';
import { type ChatInputActionsProps, type Editor } from '@lobehub/editor/react';
import { type CSSProperties } from 'react';
import { memo } from 'react';

import DocumentIdMode from './DocumentIdMode';
import EditorDataMode from './EditorDataMode';
import { EditorErrorBoundary } from './ErrorBoundary';
import InternalEditor from './InternalEditor';

/**
 * Plugin type for the editor
 * Allows any array of plugins that the Editor component accepts
 */
type EditorPlugins = Parameters<typeof Editor>[0]['plugins'];

export interface EditorCanvasProps {
  /**
   * Whether to enable auto-save in DocumentStore. Defaults to true.
   * Only applies when documentId is provided.
   */
  autoSave?: boolean;

  /**
   * Document ID to load from server.
   * When provided, component will use useSWR to fetch document data.
   */
  documentId?: string;

  /**
   * Editor data to render directly (skip fetch).
   * Use this when you already have the content and don't need to fetch.
   */
  editorData?: {
    content?: string;
    editorData?: unknown;
  };

  /**
   * Entity ID (e.g., agentId, groupId) to track which entity is being edited.
   * When entityId changes, editor content will be reloaded.
   * When entityId stays the same, editorData changes won't trigger reload.
   * This prevents focus loss during auto-save and optimistic updates.
   */
  entityId?: string;

  /**
   * Extra plugins to prepend to BASE_PLUGINS (e.g., ReactLiteXmlPlugin)
   */
  extraPlugins?: EditorPlugins;

  /**
   * Whether to show the floating toolbar. Defaults to true.
   */
  floatingToolbar?: boolean;

  /**
   * Content change handler
   */
  onContentChange?: () => void;

  /**
   * Editor initialization handler
   */
  onInit?: (editor: IEditor) => void;

  /**
   * Placeholder text for empty editor
   */
  placeholder?: string;

  /**
   * Custom plugins for the editor. If provided, replaces BASE_PLUGINS entirely.
   * Use this when you need complete control over plugins.
   */
  plugins?: EditorPlugins;

  /**
   * Slash menu items
   */
  slashItems?: SlashOptions['items'];

  /**
   * Source type for DocumentStore. Defaults to 'page'.
   */
  sourceType?: 'page' | 'notebook';

  /**
   * Custom styles for the editor
   */
  style?: CSSProperties;

  /**
   * Extra items to add to the floating toolbar (e.g., "Ask Copilot" button)
   */
  toolbarExtraItems?: ChatInputActionsProps['items'];
}

export interface EditorCanvasWithEditorProps extends EditorCanvasProps {
  /**
   * Editor instance
   */
  editor: IEditor | undefined;
}

/**
 * EditorCanvas component that accepts editor as a prop
 *
 * Three modes of operation:
 * 1. documentId mode: Pass documentId, component fetches data via useSWR, shows loading/error states
 * 2. editorData mode: Pass editorData directly, skips fetch and renders immediately
 * 3. Basic mode: No documentId or editorData, just renders the editor (original behavior)
 *
 * Features:
 * - Internal ErrorBoundary for graceful error handling
 * - Loading skeleton during fetch (documentId mode)
 * - Error state display for fetch failures (documentId mode)
 * - Auto-save integration with DocumentStore (documentId mode)
 * - AutoSave hint display (documentId mode)
 */
export const EditorCanvas = memo<EditorCanvasWithEditorProps>(
  ({ editor, documentId, editorData, entityId, ...props }) => {
    // documentId mode - fetch and render with loading/error states
    if (documentId) {
      return (
        <EditorErrorBoundary>
          <DocumentIdMode documentId={documentId} editor={editor} {...props} />
        </EditorErrorBoundary>
      );
    }

    // editorData mode - render with provided data
    if (editorData) {
      return (
        <EditorErrorBoundary>
          <EditorDataMode editor={editor} editorData={editorData} entityId={entityId} {...props} />
        </EditorErrorBoundary>
      );
    }

    // Basic mode - original behavior
    if (!editor) return null;

    return (
      <EditorErrorBoundary>
        <InternalEditor editor={editor} {...props} />
      </EditorErrorBoundary>
    );
  },
);

EditorCanvas.displayName = 'EditorCanvas';

export default EditorCanvas;

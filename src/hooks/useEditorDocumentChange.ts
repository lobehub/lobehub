'use client';

import type { IEditor } from '@lobehub/editor';
import isEqual from 'fast-deep-equal';
import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

/**
 * Options for observing meaningful document changes from a LobeHub editor.
 */
export interface UseEditorDocumentChangeOptions {
  /**
   * Optional lock that advances the comparison snapshot while suppressing the external callback.
   *
   * @default undefined
   */
  contentChangeLockRef?: RefObject<boolean>;

  /**
   * Whether callbacks should be suppressed while the editor remains observable.
   *
   * @default false
   */
  disabled?: boolean;

  /**
   * Identity of the document currently mounted in a reused editor instance.
   * Changing it resets the comparison baseline after the new document mounts.
   *
   * @default undefined
   */
  documentKey?: string;

  /** Editor instance whose Lexical document updates should be observed. */
  editor: IEditor;

  /** Callback invoked with the editor after a meaningful document mutation. */
  onContentChange?: (editor: IEditor) => void;
}

/**
 * Observes the first and subsequent dirty document updates while ignoring selection-only changes.
 *
 * Use when:
 * - Persisting rich editor content from an editor-backed feature.
 * - Reusing one editor instance while switching between keyed documents.
 *
 * Expects:
 * - The editor exposes a Lexical editor and a JSON document data source.
 * - Programmatic hydration is guarded with `contentChangeLockRef` when it must not persist.
 *
 * Returns:
 * - No value; the hook registers and cleans up a Lexical update listener.
 */
export const useEditorDocumentChange = ({
  contentChangeLockRef,
  disabled = false,
  documentKey,
  editor,
  onContentChange,
}: UseEditorDocumentChangeOptions): void => {
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  useEffect(() => {
    const lexicalEditor = editor.getLexicalEditor?.();
    if (!lexicalEditor) return;

    let previousDocumentSnapshot = editor.getDocument('json');

    // NOTICE:
    // This direct listener is needed so the first dirty update is observable.
    // `@lobehub/editor` initializes its `previousContent` inside the first dirty callback, so
    // `onTextChange` does not report one-shot paste or IME input.
    // Source/context: `node_modules/@lobehub/editor/es/plugins/common/react/ReactPlainText.js`.
    // Remove this workaround after the editor package initializes its baseline before listening.
    return lexicalEditor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;

      const currentDocumentSnapshot = editor.getDocument('json');
      if (isEqual(currentDocumentSnapshot, previousDocumentSnapshot)) return;

      previousDocumentSnapshot = currentDocumentSnapshot;

      // Hydration still advances the baseline so the next user edit compares against fresh content.
      if (contentChangeLockRef?.current) return;
      if (disabled) return;

      onContentChangeRef.current?.(editor);
    });
  }, [contentChangeLockRef, disabled, documentKey, editor]);
};

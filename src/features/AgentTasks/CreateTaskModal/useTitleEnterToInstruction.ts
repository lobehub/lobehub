import type { IEditor } from '@lobehub/editor';
import { type KeyboardEvent, useCallback } from 'react';

import { focusEditorStartLine } from '@/features/EditorCanvas/focusEditorStartLine';

/**
 * Enter in the title continues into the instruction on a fresh first line.
 * Cmd/Ctrl+Enter is left for the modal's submit shortcut.
 */
export const useTitleEnterToInstruction = (editor: IEditor | undefined) =>
  useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      // An IME Enter only confirms a candidate. Safari ends the composition before
      // this keydown, so isComposing is already false there and only keyCode 229
      // still marks the confirming Enter.
      const isImeConfirm = e.nativeEvent.isComposing || e.keyCode === 229;
      if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || isImeConfirm) return;

      e.preventDefault();
      focusEditorStartLine(editor);
    },
    [editor],
  );

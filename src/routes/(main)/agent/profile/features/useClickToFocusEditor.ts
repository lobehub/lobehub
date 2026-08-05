import { type IEditor } from '@lobehub/editor';
import { type MouseEvent, useCallback } from 'react';

/**
 * Focus the prompt editor when the user clicks the surrounding profile content
 * area, mirroring a document-style "click anywhere to type" surface.
 *
 * The handler skips focusing when the editor's root element is hidden (the
 * prompt is in Markdown source mode, which keeps the visual editor mounted but
 * `display: none`). Lexical's `focus()` falls back to `selectEnd()` when the
 * editor has no selection, so focusing the hidden editor leaves a dirty
 * end-of-document selection that scrolls the page to the bottom once the editor
 * becomes visible again. See LOBE-12593.
 */
export const useClickToFocusEditor = (editor: IEditor | undefined, canEdit: boolean) =>
  useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!canEdit) return;
      // Only focus editor for clicks within this DOM element,
      // not from React portal (e.g. Modal) whose DOM is outside this tree
      if (!e.currentTarget.contains(e.target as Node)) return;
      const rootElement = editor?.getRootElement();
      if (rootElement && rootElement.offsetParent === null) return;
      editor?.focus();
    },
    [canEdit, editor],
  );

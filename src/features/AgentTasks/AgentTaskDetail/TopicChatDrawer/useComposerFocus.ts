import { type IEditor } from '@lobehub/editor';
import { useCallback, useEffect, useRef, useState } from 'react';

interface UseComposerFocusParams {
  /** Start expanded without taking focus — a host that pins the composer open. */
  defaultExpanded: boolean;
  editor?: Pick<IEditor, 'focus'> | null;
  /**
   * Expand and focus whenever this changes to a truthy value — bumped each time
   * the drawer is opened with conversational intent, so a repeated request on
   * an already-open drawer still lands.
   */
  focusRequest?: number;
}

/**
 * Decides when the reply composer expands and when it takes focus. Only an
 * explicit request to write (the expand click or a focus request) takes focus;
 * a host that merely pins the composer open must not steal it.
 */
export const useComposerFocus = ({
  defaultExpanded,
  editor,
  focusRequest,
}: UseComposerFocusParams) => {
  const [expanded, setExpanded] = useState(defaultExpanded || !!focusRequest);
  const focusOnInitRef = useRef(!!focusRequest);

  // Focus from the editor's own init callback: a mount-time `editor.focus()`
  // runs before the lexical root attaches and is silently dropped, while
  // `onInit` fires once the kernel is ready.
  const handleEditorInit = useCallback((instance: Pick<IEditor, 'focus'>) => {
    if (focusOnInitRef.current) instance.focus?.();
  }, []);

  // "Continue chat" on a drawer that is already open for this topic keeps the
  // body mounted, so the request has to reach the live composer too.
  useEffect(() => {
    if (!focusRequest) return;
    focusOnInitRef.current = true;
    setExpanded(true);
    editor?.focus?.();
  }, [focusRequest, editor]);

  const expand = useCallback(() => {
    focusOnInitRef.current = true;
    setExpanded(true);
  }, []);

  const collapse = useCallback(() => setExpanded(false), []);

  // Open the composer for content that arrives on its own (a queued follow-up)
  // without taking focus: nothing the user did asked to write.
  const reveal = useCallback(() => setExpanded(true), []);

  return { collapse, expand, expanded, handleEditorInit, reveal };
};

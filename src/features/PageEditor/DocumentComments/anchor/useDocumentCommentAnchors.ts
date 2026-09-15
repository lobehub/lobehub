'use client';

import type { DocumentCommentSelectionAnchor, DocumentCommentThread } from '@lobechat/types';
import type { IEditor } from '@lobehub/editor';
import { debounce } from 'es-toolkit/compat';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { usePageEditorStore } from '../../store';
import { focusCommentCard, scrollAnchorIntoView } from './commentLocator';
import { clearCommentHighlights, paintCommentHighlights } from './highlights';
import type { AnchorMatch, FlattenedText } from './textAnchor';
import {
  buildAnchorRange,
  EMPTY_FLATTENED_TEXT,
  flattenEditorText,
  locateAnchor,
  offsetFromClientPoint,
} from './textAnchor';

const EMPTY_MATCHES: ReadonlyMap<string, AnchorMatch> = new Map();

/** Re-resolving on every keystroke is wasted work; the body settles far faster than a reader reacts. */
const BODY_SETTLE_DELAY = 200;
const BODY_SETTLE_MAX_WAIT = 1000;

/**
 * The body element plus a revision that ticks whenever its text changes.
 *
 * Anchors are resolved against the rendered DOM, so every content edit
 * invalidates both the flattened text and the painted ranges (Lexical swaps
 * text nodes wholesale rather than mutating them in place).
 */
const useEditorBody = (editor?: IEditor) => {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!editor) {
      setElement(null);
      return;
    }

    let disposed = false;
    let unregisterUpdates: (() => void) | undefined;
    let unregisterRoot: (() => void) | undefined;

    const bump = debounce(
      () => {
        if (!disposed) setRevision((current) => current + 1);
      },
      BODY_SETTLE_DELAY,
      { maxWait: BODY_SETTLE_MAX_WAIT },
    );

    const attach = () => {
      if (disposed) return;
      const lexical = editor.getLexicalEditor?.();
      if (!lexical) return;

      // A document switch rebuilds the Lexical editor under the same kernel,
      // so drop the previous registrations before taking new ones.
      unregisterRoot?.();
      unregisterUpdates?.();

      setElement(editor.getRootElement?.() ?? null);
      unregisterRoot = lexical.registerRootListener((root) => {
        if (!disposed) setElement(root ?? null);
      });
      unregisterUpdates = lexical.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
        // Caret moves don't change the text, so they can't move an anchor.
        if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
        bump();
      });
      // The document may already be hydrated by the time we attach.
      bump();
    };

    // The comment list mounts beside the body, but the body itself only mounts
    // once its content request resolves — a cold document shows a skeleton
    // first. Wait for the kernel's own signal instead of polling for a bounded
    // window and giving up forever on a slow load.
    editor.on('initialized', attach);
    attach();

    return () => {
      disposed = true;
      editor.off('initialized', attach);
      bump.cancel();
      unregisterUpdates?.();
      unregisterRoot?.();
    };
  }, [editor]);

  return { element, revision };
};

const sameRootIds = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
  left.size === right.size && [...left].every((id) => right.has(id));

export interface DocumentCommentAnchorsValue {
  /**
   * The thread whose run is emphasised in the body right now. A hover wins
   * while it lasts; underneath it the last deliberately picked thread stays
   * emphasised, so arriving at a quote does not immediately lose it again.
   */
  activeRootId: string | null;
  /** Scroll the body to a thread's anchor and select it. No-op for an orphaned anchor. */
  locateInBody: (rootCommentId: string) => void;
  /** Threads whose quoted run no longer exists in the body. */
  orphanedRootIds: ReadonlySet<string>;
  /** Transient emphasis while the pointer is over a card. */
  setHoveredRootId: Dispatch<SetStateAction<string | null>>;
}

/**
 * Resolve every anchored thread against the live body, paint the highlights,
 * and wire the two-way jump between a run and its comment card.
 *
 * Nothing here writes back to the server: an anchor's stored offsets are a
 * capture-time snapshot, and re-location is a pure read of the current DOM. A
 * thread whose quote is gone is reported as orphaned rather than silently
 * re-pointed at a different run.
 */
export const useDocumentCommentAnchors = (
  threads: DocumentCommentThread[],
): DocumentCommentAnchorsValue => {
  const editor = usePageEditorStore((s) => s.editor);
  // A quote captured before a document switch belongs to the previous body;
  // painting it here would highlight whatever text happens to match.
  const pendingAnchor = usePageEditorStore((s) =>
    s.pendingCommentAnchor?.documentId && s.pendingCommentAnchor.documentId === s.documentId
      ? s.pendingCommentAnchor.anchor
      : undefined,
  );
  const { element, revision } = useEditorBody(editor);

  const [hoveredRootId, setHoveredRootId] = useState<string | null>(null);
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);
  const activeRootId = hoveredRootId ?? selectedRootId;
  const [orphanedRootIds, setOrphanedRootIds] = useState<ReadonlySet<string>>(() => new Set());
  const [resolvedAt, setResolvedAt] = useState(0);

  const flatRef = useRef<FlattenedText>(EMPTY_FLATTENED_TEXT);
  const matchesRef = useRef<ReadonlyMap<string, AnchorMatch>>(EMPTY_MATCHES);
  // `threads` is rebuilt from the SWR pages on every render, so it can't be an
  // effect dependency — the resolve below writes state and would re-run itself
  // forever. The signature is the content that actually matters, as a string.
  const threadsRef = useRef(threads);
  threadsRef.current = threads;

  const anchorSignature = useMemo(
    () =>
      threads
        .flatMap(({ root }) =>
          root.selectionAnchor
            ? [`${root.id}\u0001${root.selectionAnchor.start}\u0001${root.selectionAnchor.quote}`]
            : [],
        )
        .join('\u0000'),
    [threads],
  );
  const hasPendingAnchor = Boolean(pendingAnchor);

  useEffect(() => {
    const anchors = threadsRef.current.flatMap(({ root }) =>
      root.selectionAnchor
        ? [[root.id, root.selectionAnchor] as [string, DocumentCommentSelectionAnchor]]
        : [],
    );

    // Most documents carry no anchors at all; skip the body walk entirely for them.
    const flat =
      anchors.length > 0 || hasPendingAnchor ? flattenEditorText(element) : EMPTY_FLATTENED_TEXT;
    const matches = new Map<string, AnchorMatch>();
    const orphaned = new Set<string>();

    for (const [rootId, anchor] of anchors) {
      const match = locateAnchor(flat, anchor);
      if (match) matches.set(rootId, match);
      else orphaned.add(rootId);
    }

    flatRef.current = flat;
    matchesRef.current = matches;
    setOrphanedRootIds((current) => (sameRootIds(current, orphaned) ? current : orphaned));
    setResolvedAt((current) => current + 1);
  }, [anchorSignature, element, hasPendingAnchor, revision]);

  useEffect(() => {
    paintCommentHighlights({
      activeRootId,
      flat: flatRef.current,
      matches: matchesRef.current,
      pending: pendingAnchor ? locateAnchor(flatRef.current, pendingAnchor) : null,
    });
  }, [activeRootId, pendingAnchor, resolvedAt]);

  useEffect(() => () => clearCommentHighlights(), []);

  const locateInBody = useCallback((rootCommentId: string) => {
    const match = matchesRef.current.get(rootCommentId);
    if (!match) return;
    const range = buildAnchorRange(flatRef.current, match);
    if (!range) return;
    scrollAnchorIntoView(range);
    // Jumping to a quote is a deliberate pick, so the run stays emphasised
    // until another thread is picked or the reader clicks elsewhere in the
    // body. A timed flash would drop it seconds after they arrive.
    setSelectedRootId(rootCommentId);
  }, []);

  // Clicking a run selects its thread. Selecting moves nothing, so unlike the
  // old jump-to-the-comment behaviour it can't interrupt someone mid-edit and
  // needs no "is the reader typing?" guard — that guard was what made a second
  // click inside the body do nothing at all once the editor held focus.
  //
  // It deliberately does NOT scroll to the card: the comment list lives below
  // the body, so scrolling would throw the reader to the bottom of the page
  // just for pointing at a sentence. LOBE-14151 (cards beside the text) turns
  // this into focusing the card in place.
  useEffect(() => {
    if (!element) return;

    const handleClick = (event: MouseEvent) => {
      if (matchesRef.current.size === 0) return;
      // A drag that ends inside a run is a text selection, not a pick.
      const selection = element.ownerDocument.defaultView?.getSelection();
      if (selection && !selection.isCollapsed) return;

      const offset = offsetFromClientPoint(element, flatRef.current, event.clientX, event.clientY);
      if (offset === null) return;

      // Nested anchors are legal; the tightest one is the one being pointed at.
      let hitId: string | null = null;
      let hitLength = Number.POSITIVE_INFINITY;
      for (const [rootId, match] of matchesRef.current) {
        const length = match.end - match.start;
        if (offset >= match.start && offset < match.end && length < hitLength) {
          hitId = rootId;
          hitLength = length;
        }
      }
      setSelectedRootId(hitId);
      if (!hitId) return;

      focusCommentCard(hitId, { scroll: false });
    };

    element.addEventListener('click', handleClick);
    return () => element.removeEventListener('click', handleClick);
  }, [element]);

  return useMemo(
    () => ({ activeRootId, locateInBody, orphanedRootIds, setHoveredRootId }),
    [activeRootId, locateInBody, orphanedRootIds],
  );
};

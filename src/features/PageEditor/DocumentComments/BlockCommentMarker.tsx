'use client';

import { HIDE_TOOLBAR_COMMAND } from '@lobehub/editor';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { MessageSquarePlus } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';

import { usePageEditorStore } from '../store';
import { useCommentAnchors } from './anchor/context';
import { captureRangeAnchor } from './anchor/textAnchor';
import { useDocumentComments } from './context';
import { styles } from './styles';

interface MarkerTarget {
  /** The visual line under the pointer, as a live DOM range. */
  range: Range;
  top: number;
}

interface CaretPoint {
  node: Node;
  offset: number;
}

/** The DOM point under a viewport coordinate, or `null` outside any text. */
const caretAt = (doc: Document, x: number, y: number): CaretPoint | null => {
  const d = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offset: number; offsetNode: Node } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = d.caretPositionFromPoint?.(x, y);
  if (position?.offsetNode) return { node: position.offsetNode, offset: position.offset };
  const range = d.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
};

/**
 * Two caret points ordered by document position. On an RTL line the visual
 * left edge is the *later* point in the DOM (RTL reads right to left), so the
 * left/right caret pair can't be assigned to start/end by which is which —
 * only by which comes first in the document.
 */
const orderPoints = (doc: Document, a: CaretPoint, b: CaretPoint): [CaretPoint, CaretPoint] => {
  const probe = doc.createRange();
  probe.setStart(a.node, a.offset);
  probe.collapse(true);
  return probe.comparePoint(b.node, b.offset) < 0 ? [b, a] : [a, b];
};

/**
 * The visual line of `block` at viewport height `y`: the run between the
 * caret positions at the block's left and right edges on that line. Falls
 * back to the whole block when the edges cannot be resolved (an image, an
 * embed), so the marker still offers something to comment on.
 */
export const lineAt = (block: HTMLElement, y: number): Range | null => {
  const doc = block.ownerDocument;
  const rect = block.getBoundingClientRect();
  const left = caretAt(doc, rect.left + 1, y);
  const right = caretAt(doc, rect.right - 1, y);
  const range = doc.createRange();
  if (left && right && block.contains(left.node) && block.contains(right.node)) {
    try {
      const [from, to] = orderPoints(doc, left, right);
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
      if (!range.collapsed && range.toString().trim()) return range;
    } catch {
      /* fall through to the whole block */
    }
  }
  range.selectNodeContents(block);
  return range.toString().trim() ? range : null;
};

/** Two ranges over the same run are the same target; the marker need not move. */
const sameRange = (left: Range | undefined, right: Range) =>
  Boolean(left) &&
  left!.startContainer === right.startContainer &&
  left!.startOffset === right.startOffset &&
  left!.endContainer === right.endContainer &&
  left!.endOffset === right.endOffset;

/**
 * The body's top-level block the pointer is over, or `null` over the body's
 * own (root-owned) whitespace between and after blocks, and outside it.
 */
export const blockAt = (body: HTMLElement, target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof Node)) return null;
  let node: Node | null = target;
  while (node && node.parentNode !== body) node = node.parentNode;
  return node instanceof HTMLElement ? node : null;
};

/**
 * Whether a point sits in the corridor bridging the body and the marker, at
 * the marker's own row height — the natural path from a highlighted line to
 * its (not directly adjoining) marker. Direction-agnostic: works whether the
 * marker sits to the body's physical left or right (RTL vs LTR).
 */
export const inMarkerBridge = (
  x: number,
  y: number,
  bodyRect: DOMRect,
  markerRect: DOMRect,
): boolean => {
  const left = Math.min(bodyRect.left, markerRect.left);
  const right = Math.max(bodyRect.right, markerRect.right);
  return x >= left && x <= right && y >= markerRect.top && y <= markerRect.bottom;
};

/**
 * The comment marker that appears in the body's right margin next to the
 * line under the pointer. Clicking it comments on that visual line, so a
 * reader can annotate a sentence without selecting it first.
 *
 * Mounted inside the editor column, absolutely positioned, so the marker
 * moves with the text it stands beside.
 */
const BlockCommentMarker = memo<{ hostRef: React.RefObject<HTMLElement | null> }>(({ hostRef }) => {
  const { t } = useTranslation('file');
  const state = useDocumentComments();
  const { bodyElement } = useCommentAnchors();
  const { allowed: canComment } = usePermission('create_content');
  const setPendingCommentAnchor = usePageEditorStore((s) => s.setPendingCommentAnchor);
  const editor = usePageEditorStore((s) => s.editor);
  const [target, setTarget] = useState<MarkerTarget | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const markerRef = useRef<HTMLDivElement>(null);
  const documentId = state?.documentId;
  const enabled = Boolean(documentId) && canComment && Boolean(bodyElement);

  useEffect(() => {
    const host = hostRef.current;
    if (!enabled || !bodyElement || !host) return;

    // The marker sits outside the body's DOM subtree, past the column's own
    // padding — neither a body-only `pointerleave` (old approach) nor a
    // target-containment check on host `pointermove` (still real, but the
    // pointer visiting the gap between body and marker generates its own
    // `pointermove` there too) survives the crossing: both clear the target
    // the instant the pointer is over the gap itself, before it ever reaches
    // the marker. Treat the rectangle spanning body and marker, at the
    // marker's own row height, as one continuous hoverable bridge — the
    // natural path from a highlighted line to its marker never leaves it.
    const pointerStaysWithMarker = (event: PointerEvent) => {
      const marker = markerRef.current;
      if (!marker) return false;
      if (event.target instanceof Node && marker.contains(event.target)) return true;
      return inMarkerBridge(
        event.clientX,
        event.clientY,
        bodyElement.getBoundingClientRect(),
        marker.getBoundingClientRect(),
      );
    };
    const handleMove = (event: PointerEvent) => {
      const block = blockAt(bodyElement, event.target);
      // Root-owned whitespace between or after blocks is no line at all; the
      // marker for the last line the pointer crossed must not stay actionable
      // there — unless the pointer is on the bridge to that very marker, the
      // one path it is meant to survive (the bridge's row is inside the body
      // too, so the host-level handler never sees these moves).
      if (!block) {
        if (!pointerStaysWithMarker(event)) setTarget(null);
        return;
      }
      // A line with nothing to quote (an empty paragraph, a divider) has no
      // marker: the anchor it would produce is empty.
      const range = lineAt(block, event.clientY);
      if (!range) {
        setTarget(null);
        return;
      }
      if (sameRange(targetRef.current?.range, range)) return;
      const lineRect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      const top = lineRect.top - host.getBoundingClientRect().top;
      setTarget({ range, top });
    };
    const handleLeave = () => setTarget(null);
    const handleHostMove = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && bodyElement.contains(target)) return;
      if (!pointerStaysWithMarker(event)) setTarget(null);
    };

    bodyElement.addEventListener('pointermove', handleMove);
    host.addEventListener('pointermove', handleHostMove);
    host.addEventListener('pointerleave', handleLeave);
    return () => {
      bodyElement.removeEventListener('pointermove', handleMove);
      host.removeEventListener('pointermove', handleHostMove);
      host.removeEventListener('pointerleave', handleLeave);
      setTarget(null);
    };
  }, [bodyElement, enabled, hostRef]);

  const handleClick = useCallback(() => {
    const range = targetRef.current?.range;
    if (!range || !documentId) return;
    const anchor = captureRangeAnchor(bodyElement, range);
    if (!anchor) return;
    setPendingCommentAnchor({ anchor, documentId });
    setTarget(null);
    // Same hand-off as the toolbar's Comment action: the composer takes
    // focus, so the body's selection toolbar must not linger over the text.
    editor?.dispatchCommand(HIDE_TOOLBAR_COMMAND, undefined);
    editor?.blur();
  }, [bodyElement, documentId, editor, setPendingCommentAnchor]);

  if (!enabled || !target) return null;

  return (
    // Leaving the marker for anywhere else in the host, including the gap
    // back to the body, is covered by the host-level pointermove above; no
    // listener of its own needed here.
    <div className={styles.blockMarker} ref={markerRef} style={{ top: target.top }}>
      <ActionIcon
        aria-label={t('pageEditor.comments.anchor.addToLine')}
        icon={MessageSquarePlus}
        size={'small'}
        title={t('pageEditor.comments.anchor.addToLine')}
        onClick={handleClick}
        // The body's selection toolbar reads the selection on pointer-down;
        // pressing this must neither collapse a selection nor move focus.
        onPointerDown={(event) => event.preventDefault()}
      />
    </div>
  );
});

BlockCommentMarker.displayName = 'DocumentCommentBlockMarker';

export default BlockCommentMarker;

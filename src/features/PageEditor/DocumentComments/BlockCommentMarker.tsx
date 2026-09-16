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
 * The visual line of `block` at viewport height `y`: the run between the
 * caret positions at the block's left and right edges on that line. Falls
 * back to the whole block when the edges cannot be resolved (an image, an
 * embed), so the marker still offers something to comment on.
 */
const lineAt = (block: HTMLElement, y: number): Range | null => {
  const doc = block.ownerDocument;
  const rect = block.getBoundingClientRect();
  const start = caretAt(doc, rect.left + 1, y);
  const end = caretAt(doc, rect.right - 1, y);
  const range = doc.createRange();
  if (start && end && block.contains(start.node) && block.contains(end.node)) {
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
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

/** The body's top-level block the pointer is over, if any. */
const blockAt = (body: HTMLElement, target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof Node)) return null;
  let node: Node | null = target;
  while (node && node.parentNode !== body) node = node.parentNode;
  return node instanceof HTMLElement ? node : null;
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
  const documentId = state?.documentId;
  const enabled = Boolean(documentId) && canComment && Boolean(bodyElement);

  useEffect(() => {
    const host = hostRef.current;
    if (!enabled || !bodyElement || !host) return;

    const handleMove = (event: PointerEvent) => {
      const block = blockAt(bodyElement, event.target);
      if (!block) return;
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

    bodyElement.addEventListener('pointermove', handleMove);
    host.addEventListener('pointerleave', handleLeave);
    return () => {
      bodyElement.removeEventListener('pointermove', handleMove);
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
    <div className={styles.blockMarker} style={{ top: target.top }}>
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

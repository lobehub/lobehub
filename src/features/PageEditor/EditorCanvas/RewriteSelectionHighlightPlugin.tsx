'use client';

import {
  $findNodeById,
  type CapturedCollaborativeRewriteSelection,
  IAISessionService,
  type IEditor,
} from '@lobehub/editor';
import { hashRewriteText, normalizeRewriteText } from '@lobehub/editor';
import {
  $createRangeSelection,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
  type PointType,
  type RangeSelection,
  type TextNode,
} from 'lexical';
import { useLayoutEffect } from 'react';

const HIGHLIGHT_NAME = 'page-rewrite-selection';
const HIGHLIGHT_STYLE_ID = 'page-rewrite-selection-highlight-style';

const HIGHLIGHT_STYLE = `
::highlight(${HIGHLIGHT_NAME}) {
  color: inherit;
  background-color: rgba(250, 204, 21, 0.36);
}

[data-page-rewrite-selection-overlay] {
  position: absolute;
  z-index: 4;
  pointer-events: none;
  border-radius: 2px;
  background: rgba(250, 204, 21, 0.36);
  box-sizing: border-box;
}
`;

type HighlightRegistryLike = {
  delete: (name: string) => boolean;
  set: (name: string, highlight: unknown) => unknown;
};

type BrowserCSS = {
  highlights?: HighlightRegistryLike;
};

type BrowserWindow = Window & {
  CSS?: BrowserCSS;
  Highlight?: new (...ranges: Range[]) => unknown;
  visualViewport?: VisualViewport;
};

/**
 * The request row is intentionally represented as a small rendering DTO.
 * Keeping request status/session metadata next to the durable selection lets
 * the renderer switch to provenance while a generation is writing without
 * making the editor selection or document part of the state machine.
 */
export interface RewriteSelectionHighlightTarget {
  outputText?: string | null;
  /** Do not fall back to a stale quote when a continuation's provenance is absent. */
  provenanceOnly?: boolean;
  requestId?: string | null;
  selection?: CapturedCollaborativeRewriteSelection | Record<string, unknown> | null;
  sessionId?: string | null;
  status?: string;
}

type RewriteSelectionValue = NonNullable<RewriteSelectionHighlightTarget['selection']>;

interface ResolvedTextPoint {
  node: TextNode;
  offset: number;
}

interface DOMPoint {
  node: Node;
  offset: number;
}

interface AISessionRangeLike {
  end?: number;
  endOffset?: number;
  key?: string;
  nodeKey?: string;
  start?: number;
  startOffset?: number;
}

interface OverlayRect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

const getTextLeaves = (node: LexicalNode): TextNode[] => {
  if ($isTextNode(node)) return [node];
  if (!$isElementNode(node)) return [];

  return node.getChildren().flatMap((child) => getTextLeaves(child));
};

/** Resolve a durable character offset to a Lexical text point without writing editor state. */
const resolveBlockOffset = (block: LexicalNode, blockOffset: number): ResolvedTextPoint | null => {
  if (!Number.isSafeInteger(blockOffset) || blockOffset < 0) return null;

  const leaves = getTextLeaves(block);
  let offset = blockOffset;

  for (const leaf of leaves) {
    const size = leaf.getTextContentSize();
    if (offset <= size) return { node: leaf, offset };
    offset -= size;
  }

  if (offset === 0 && leaves.length > 0) {
    const lastLeaf = leaves.at(-1);
    if (lastLeaf) return { node: lastLeaf, offset: lastLeaf.getTextContentSize() };
  }

  return null;
};

const findTextNode = (element: Node): Text | null => {
  if (element.nodeType === Node.TEXT_NODE) return element as Text;

  const ownerDocument = element.ownerDocument;
  if (!ownerDocument) return null;

  const walker = ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text | null;
};

const getDOMTextNodes = (element: Node): Text[] => {
  if (element.nodeType === Node.TEXT_NODE) return [element as Text];

  const ownerDocument = element.ownerDocument;
  if (!ownerDocument) return [];

  const walker = ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }
  return textNodes;
};

const resolveDOMTextPoint = (element: Node, offset: number): DOMPoint | null => {
  if (!Number.isSafeInteger(offset) || offset < 0) return null;

  const textNodes = getDOMTextNodes(element);
  let remaining = offset;

  for (const textNode of textNodes) {
    if (remaining <= textNode.data.length) {
      return { node: textNode, offset: remaining };
    }
    remaining -= textNode.data.length;
  }

  if (remaining === 0) {
    const lastTextNode = textNodes.at(-1);
    if (lastTextNode) return { node: lastTextNode, offset: lastTextNode.data.length };
  }

  return null;
};

const toDOMPoint = (editor: LexicalEditor, point: PointType): DOMPoint | null => {
  const element = editor.getElementByKey(point.key);
  if (!element) return null;

  if (point.type === 'text') {
    const textNode = findTextNode(element);
    if (!textNode) return null;
    return {
      node: textNode,
      offset: Math.min(Math.max(point.offset, 0), textNode.data.length),
    };
  }

  return {
    node: element,
    offset: Math.min(Math.max(point.offset, 0), element.childNodes.length),
  };
};

/** The local equivalent of Lexical's createDOMRange, kept here until the package exports it. */
const createDOMRange = (editor: LexicalEditor, selection: RangeSelection): Range | null => {
  const start = selection.isBackward() ? selection.focus : selection.anchor;
  const end = selection.isBackward() ? selection.anchor : selection.focus;
  const startPoint = toDOMPoint(editor, start);
  const endPoint = toDOMPoint(editor, end);
  const ownerDocument = editor.getRootElement()?.ownerDocument;
  if (!startPoint || !endPoint || !ownerDocument) return null;

  try {
    const range = ownerDocument.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    return range;
  } catch {
    return null;
  }
};

const createDOMRangeFromOffsets = (
  ownerDocument: Document,
  element: Node,
  startOffset: number,
  endOffset: number,
): Range | null => {
  const startPoint = resolveDOMTextPoint(element, startOffset);
  const endPoint = resolveDOMTextPoint(element, endOffset);
  if (!startPoint || !endPoint) return null;

  try {
    const range = ownerDocument.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    return range;
  } catch {
    return null;
  }
};

const getSelectionText = (selection: RangeSelection): string | null => {
  try {
    return selection.getTextContent();
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNodeRewriteSelection = (selection: RewriteSelectionValue | null | undefined): boolean =>
  isRecord(selection) && selection.targetKind === 'node';

/** Resolve only an atomic card host; never walk its text or use provenance. */
const resolveNodeSelectionElement = (
  editor: IEditor,
  captured: RewriteSelectionValue,
): HTMLElement | null => {
  const lexicalEditor = editor.getLexicalEditor?.();
  const root = editor.getRootElement?.();
  const nodeId = (captured as Record<string, unknown>).targetNodeId;
  if (!lexicalEditor || !root || typeof nodeId !== 'string') return null;
  let result: HTMLElement | null = null;
  lexicalEditor.getEditorState().read(() => {
    const node = $findNodeById(nodeId);
    const element = node && lexicalEditor.getElementByKey(node.getKey());
    if (!element || !root.contains(element)) return;
    const host = element.closest<HTMLElement>('[data-hole="true"]') ?? element;
    if (root.contains(host) && host.matches('[data-hole="true"], [data-lexical-decorator="true"]'))
      result = host;
  });
  return result;
};

const isDurableSelection = (
  selection: RewriteSelectionValue | null | undefined,
): selection is CapturedCollaborativeRewriteSelection => {
  if (!isRecord(selection)) return false;

  return (
    typeof selection.startNodeId === 'string' &&
    typeof selection.endNodeId === 'string' &&
    Number.isSafeInteger(selection.startOffset) &&
    Number.isSafeInteger(selection.endOffset) &&
    typeof selection.quotedText === 'string' &&
    typeof selection.quotedTextHash === 'string'
  );
};

/** Stable identity for a target. `capturedAt` is omitted so a server row and
 * the still-open composer collapse to one visual range. */
export const getRewriteSelectionIdentity = (
  selection: RewriteSelectionHighlightTarget['selection'],
): string | null => {
  if (!isDurableSelection(selection)) return null;

  return [
    selection.kind,
    'roomId' in selection ? selection.roomId : '',
    selection.startNodeId,
    selection.startOffset,
    selection.endNodeId,
    selection.endOffset,
    selection.quotedTextHash,
    selection.quotedText,
  ]
    .map((value) => String(value ?? ''))
    .join('\u0000');
};

const matchesCapturedSelection = (
  selection: RangeSelection,
  captured: CapturedCollaborativeRewriteSelection,
): boolean => {
  const text = getSelectionText(selection);
  if (text === null) return false;

  return (
    normalizeRewriteText(text) === normalizeRewriteText(captured.quotedText) &&
    hashRewriteText(text) === captured.quotedTextHash
  );
};

const buildBlockSelection = (
  captured: CapturedCollaborativeRewriteSelection,
): RangeSelection | null => {
  const startBlock = $findNodeById(captured.startNodeId);
  const endBlock = $findNodeById(captured.endNodeId);
  if (!startBlock || !endBlock) return null;

  const start = resolveBlockOffset(startBlock, captured.startOffset);
  const end = resolveBlockOffset(endBlock, captured.endOffset);
  if (!start || !end) return null;

  const selection = $createRangeSelection();
  selection.anchor.set(start.node.getKey(), start.offset, 'text');
  selection.focus.set(end.node.getKey(), end.offset, 'text');
  return selection;
};

const resolveSelectionRange = (
  editor: IEditor,
  captured: CapturedCollaborativeRewriteSelection,
): Range | null => {
  const lexicalEditor = editor.getLexicalEditor?.();
  if (!lexicalEditor || !editor.getRootElement?.()) return null;

  let resolved: Range | null = null;
  lexicalEditor.getEditorState().read(() => {
    const currentSelection = $getSelection();
    // The current Lexical selection is the most precise browser-side
    // projection of a Yjs-relative selection. It survives focus moving to
    // the composer, while the native browser selection itself does not.
    if (
      $isRangeSelection(currentSelection) &&
      !currentSelection.isCollapsed() &&
      matchesCapturedSelection(currentSelection, captured)
    ) {
      resolved = createDOMRange(lexicalEditor, currentSelection);
    }

    if (resolved) return;

    // A detached relative point (or an editor without a Yjs binding) still
    // has a safe durable block/offset projection. This never mutates the
    // editor selection and is intentionally a rendering-only fallback.
    const blockSelection = buildBlockSelection(captured);
    if (!blockSelection || !matchesCapturedSelection(blockSelection, captured)) return;
    resolved = createDOMRange(lexicalEditor, blockSelection);
  });

  return resolved;
};

const resolveAISessionRange = (editor: IEditor, sessionRange: AISessionRangeLike): Range | null => {
  const lexicalEditor = editor.getLexicalEditor?.();
  const root = editor.getRootElement?.();
  if (!lexicalEditor || !root) return null;

  const nodeKey = sessionRange.nodeKey || sessionRange.key;
  if (!nodeKey) return null;
  const element = lexicalEditor.getElementByKey(nodeKey);
  if (!element || !root.contains(element)) return null;

  const startOffset = sessionRange.startOffset ?? sessionRange.start;
  const endOffset = sessionRange.endOffset ?? sessionRange.end;
  if (
    typeof startOffset !== 'number' ||
    typeof endOffset !== 'number' ||
    !Number.isSafeInteger(startOffset) ||
    !Number.isSafeInteger(endOffset)
  )
    return null;

  return createDOMRangeFromOffsets(root.ownerDocument, element, startOffset, endOffset);
};

export const resolveAISessionDOMRanges = (editor: IEditor, sessionId: string): Range[] => {
  const root = editor.getRootElement?.();
  if (!root || !sessionId) return [];

  const elements = [
    ...(root.matches('[data-ai-session-id]') ? [root] : []),
    ...Array.from(root.querySelectorAll<HTMLElement>('[data-ai-session-id]')),
  ].filter((element) => element.dataset.aiSessionId === sessionId);
  return elements
    .map((element) => {
      const textNodes = getDOMTextNodes(element);
      const first = textNodes[0];
      const last = textNodes.at(-1);
      if (!first || !last) return null;

      try {
        const range = root.ownerDocument.createRange();
        range.setStart(first, 0);
        range.setEnd(last, last.data.length);
        return range;
      } catch {
        return null;
      }
    })
    .filter((range): range is Range => Boolean(range));
};

interface ResolvedAISessionRanges {
  hasProvenance: boolean;
  ranges: Range[];
}

/**
 * Resolve live provenance ranges without comparing them with the original
 * quoted text. During streaming the generated text is expected to differ,
 * and the live node offsets are the authoritative projection.
 */
const resolveAISessionRanges = (editor: IEditor, sessionId: string): ResolvedAISessionRanges => {
  const service = editor.requireService(IAISessionService);
  if (!sessionId) return { hasProvenance: false, ranges: [] };

  const sessionRanges = (() => {
    try {
      const ranges = service?.getRanges(sessionId);
      return (Array.isArray(ranges) ? ranges : []) as AISessionRangeLike[];
    } catch {
      return [];
    }
  })();
  const ranges = sessionRanges
    .map((sessionRange) => resolveAISessionRange(editor, sessionRange))
    .filter((range): range is Range => Boolean(range));
  if (ranges.length > 0) return { hasProvenance: true, ranges };

  // A hard refresh can sync NodeState to DOM before the AISessionService has
  // rebuilt its Lexical range cache. The DOM attribute is emitted by that
  // same NodeState projection, so it is a safe rendering-only recovery path.
  const domRanges = resolveAISessionDOMRanges(editor, sessionId);
  if (domRanges.length > 0) return { hasProvenance: true, ranges: domRanges };

  if (sessionRanges.length > 0) {
    // Provenance exists but its DOM nodes are not materialized yet. Keep the
    // original selection out of the fallback path; its hash may be stale.
    return { hasProvenance: true, ranges: [] };
  }

  return { hasProvenance: false, ranges: [] };
};

/** Merge adjacent/overlapping client rects from all durable targets. */
export const mergeOverlayRects = (rects: readonly DOMRect[]): OverlayRect[] => {
  const ordered = rects
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
    }))
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const merged: OverlayRect[] = [];

  for (const rect of ordered) {
    const overlaps = (candidate: OverlayRect, next: OverlayRect) =>
      next.left <= candidate.right + 2 &&
      next.right >= candidate.left - 2 &&
      next.top <= candidate.bottom + 2 &&
      next.bottom >= candidate.top - 2;

    let mergeIndex = merged.findIndex((candidate) => overlaps(candidate, rect));
    if (mergeIndex === -1) {
      merged.push({ ...rect });
      continue;
    }

    const target = merged[mergeIndex]!;
    target.bottom = Math.max(target.bottom, rect.bottom);
    target.left = Math.min(target.left, rect.left);
    target.right = Math.max(target.right, rect.right);
    target.top = Math.min(target.top, rect.top);

    // A range can bridge two earlier rectangles that did not overlap before
    // it was merged. Collapse those transitive overlaps as one overlay too.
    for (let index = merged.length - 1; index >= 0; index--) {
      if (index === mergeIndex || !overlaps(target, merged[index]!)) continue;
      const candidate = merged[index]!;
      target.bottom = Math.max(target.bottom, candidate.bottom);
      target.left = Math.min(target.left, candidate.left);
      target.right = Math.max(target.right, candidate.right);
      target.top = Math.min(target.top, candidate.top);
      merged.splice(index, 1);
      if (index < mergeIndex) mergeIndex -= 1;
    }
  }

  return merged;
};

const getRangeClientRects = (range: Range): DOMRect[] => {
  const rects =
    typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : [];
  if (rects.length > 0) return rects;

  if (typeof range.getBoundingClientRect !== 'function') return [];
  const boundingRect = range.getBoundingClientRect();
  return boundingRect.width > 0 && boundingRect.height > 0 ? [boundingRect] : [];
};

const isOverlayContainingBlock = (element: HTMLElement, ownerWindow: Window): boolean => {
  const style = ownerWindow.getComputedStyle(element);
  if (style.position && style.position !== 'static') return true;

  // A transform/filter/contain also establishes the containing block for an
  // absolutely positioned descendant even when `position` remains static.
  if (
    (style.transform && style.transform !== 'none') ||
    (style.perspective && style.perspective !== 'none') ||
    (style.filter && style.filter !== 'none') ||
    (style.contain && style.contain !== 'none')
  ) {
    return true;
  }

  return style.willChange
    .split(',')
    .some((value) => /transform|perspective|filter|contain/.test(value.trim()));
};

const getOverlayHost = (root: HTMLElement): HTMLElement => {
  const ownerDocument = root.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  let current = root.parentElement;
  while (current) {
    if (!ownerWindow || isOverlayContainingBlock(current, ownerWindow)) return current;
    current = current.parentElement;
  }

  return ownerDocument.body ?? ownerDocument.documentElement;
};

interface OverlayHostMetrics {
  clientLeft: number;
  clientTop: number;
  left: number;
  scaleX: number;
  scaleY: number;
  scrollLeft: number;
  scrollTop: number;
  top: number;
}

interface OverlayClip {
  bottom: number;
  clipX: boolean;
  clipY: boolean;
  left: number;
  right: number;
  top: number;
}

const getOverlayHostMetrics = (host: HTMLElement): OverlayHostMetrics => {
  const hostRect = host.getBoundingClientRect();
  // Range client rects and getBoundingClientRect() are viewport coordinates,
  // while an absolutely positioned child uses the host's CSS coordinate
  // space. CSS zoom/transforms make those spaces differ; derive the visual
  // scale from the host's layout box when it is measurable.
  const scaleX = host.offsetWidth > 0 ? hostRect.width / host.offsetWidth : 1;
  const scaleY = host.offsetHeight > 0 ? hostRect.height / host.offsetHeight : 1;

  return {
    clientLeft: host.clientLeft,
    clientTop: host.clientTop,
    left: hostRect.left,
    scaleX: Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1,
    scaleY: Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1,
    scrollLeft: host.scrollLeft,
    scrollTop: host.scrollTop,
    top: hostRect.top,
  };
};

const getOverlayClip = (element: HTMLElement, ownerWindow: Window): OverlayClip | null => {
  const style = ownerWindow.getComputedStyle(element);
  const hasPageScrollContainerMarker = element.hasAttribute('data-page-editor-scroll-container');
  const clipX =
    hasPageScrollContainerMarker ||
    /hidden|clip|auto|scroll|overlay/.test([style.overflow, style.overflowX].join(' '));
  const clipY =
    hasPageScrollContainerMarker ||
    /hidden|clip|auto|scroll|overlay/.test([style.overflow, style.overflowY].join(' '));
  if (!clipX && !clipY) return null;

  const rect = element.getBoundingClientRect();
  const scaleX = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1;
  const scaleY = element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1;
  const left = rect.left + element.clientLeft * scaleX;
  const top = rect.top + element.clientTop * scaleY;
  const right = left + element.clientWidth * scaleX;
  const bottom = top + element.clientHeight * scaleY;
  if (![left, top, right, bottom].every(Number.isFinite)) return null;

  return { bottom, clipX, clipY, left, right, top };
};

const getOverlayClips = (start: HTMLElement | null): OverlayClip[] => {
  const ownerWindow = start?.ownerDocument.defaultView;
  if (!ownerWindow) return [];

  const clips: OverlayClip[] = [];
  let current: HTMLElement | null = start;
  while (current) {
    const clip = getOverlayClip(current, ownerWindow);
    if (clip) clips.push(clip);
    current = current.parentElement;
  }
  return clips;
};

const getRangeOverlayClips = (
  root: HTMLElement,
  range: Range,
  rootClips: readonly OverlayClip[],
): OverlayClip[] => {
  const clips = [...rootClips];
  let current: HTMLElement | null;
  for (const container of [range.startContainer, range.endContainer]) {
    current =
      container.nodeType === Node.ELEMENT_NODE
        ? (container as HTMLElement)
        : container.parentElement;
    while (current && current !== root) {
      const ownerWindow = root.ownerDocument.defaultView;
      const clip = ownerWindow ? getOverlayClip(current, ownerWindow) : null;
      if (clip) clips.push(clip);
      current = current.parentElement;
    }
  }
  return clips;
};

const clipOverlayRect = (rect: DOMRect, clips: readonly OverlayClip[]): DOMRect | null => {
  let left = rect.left;
  let right = rect.right;
  let top = rect.top;
  let bottom = rect.bottom;

  for (const clip of clips) {
    if (clip.clipX) {
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
    }
    if (clip.clipY) {
      top = Math.max(top, clip.top);
      bottom = Math.min(bottom, clip.bottom);
    }
    if (right <= left || bottom <= top) return null;
  }

  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  } as DOMRect;
};

const createOverlays = (
  ownerDocument: Document,
  host: HTMLElement,
  root: HTMLElement,
  ranges: readonly Range[],
): HTMLDivElement[] => {
  const hostMetrics = getOverlayHostMetrics(host);
  const rootClips = getOverlayClips(root);
  const rects = mergeOverlayRects(
    ranges.flatMap((range) =>
      getRangeClientRects(range).flatMap((rect) => {
        const clips = getRangeOverlayClips(root, range, rootClips);
        const clipped = clipOverlayRect(rect, clips);
        return clipped ? [clipped] : [];
      }),
    ),
  );
  return rects.map((rect) => {
    const overlay = ownerDocument.createElement('div');
    overlay.dataset.pageRewriteSelectionOverlay = 'true';
    overlay.style.left = `${(rect.left - hostMetrics.left) / hostMetrics.scaleX + hostMetrics.scrollLeft - hostMetrics.clientLeft}px`;
    overlay.style.top = `${(rect.top - hostMetrics.top) / hostMetrics.scaleY + hostMetrics.scrollTop - hostMetrics.clientTop}px`;
    overlay.style.width = `${(rect.right - rect.left) / hostMetrics.scaleX}px`;
    overlay.style.height = `${(rect.bottom - rect.top) / hostMetrics.scaleY}px`;
    return overlay;
  });
};

const ensureHighlightStyle = (ownerDocument: Document): HTMLStyleElement | null => {
  const existing = ownerDocument.getElementById(HIGHLIGHT_STYLE_ID);
  if (existing?.tagName === 'STYLE') return null;

  const style = ownerDocument.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = HIGHLIGHT_STYLE;
  (ownerDocument.head || ownerDocument.documentElement).append(style);
  return style;
};

const HIGHLIGHT_OWNERS = new WeakMap<Document, symbol>();

const addEventListenerWithCleanup = (
  target: EventTarget,
  type: string,
  listener: () => void,
  options?: AddEventListenerOptions,
): (() => void) => {
  const eventListener = listener as EventListener;
  target.addEventListener(type, eventListener, options);
  return () => target.removeEventListener(type, eventListener, options?.capture ?? false);
};

const RewriteSelectionHighlightPlugin = ({
  continuationTarget,
  editor,
  selection,
  selections,
}: {
  continuationTarget?: RewriteSelectionHighlightTarget | null;
  editor?: IEditor;
  /** Legacy single-selection prop; retained for callers outside PageEditor. */
  selection?: CapturedCollaborativeRewriteSelection | null;
  /** All composer/request targets are projected by this one plugin instance. */
  selections?: readonly RewriteSelectionHighlightTarget[];
}) => {
  useLayoutEffect(() => {
    if (!editor) return;

    let disposed = false;
    let animationFrame: number | undefined;
    let observedRoot: HTMLElement | null = null;
    let mutationObserver: MutationObserver | null = null;
    let activeRoot: HTMLElement | null = null;
    let activeRegistry: HighlightRegistryLike | undefined;
    let activeOverlay: HTMLDivElement[] = [];
    let activeBlockElements: HTMLElement[] = [];
    let ownedStyle: HTMLStyleElement | null = null;
    let ownedDocument: Document | null = null;
    let layoutOwnerWindow: BrowserWindow | null = null;
    let layoutVisualViewport: VisualViewport | null = null;
    let layoutRoot: HTMLElement | null = null;
    let layoutListenerCleanups: Array<() => void> = [];
    const ownerToken = Symbol('page-rewrite-selection-highlight');

    const ownsDocument = (ownerDocument: Document): boolean => {
      const currentOwner = HIGHLIGHT_OWNERS.get(ownerDocument);
      if (currentOwner && currentOwner !== ownerToken) return false;
      HIGHLIGHT_OWNERS.set(ownerDocument, ownerToken);
      ownedDocument = ownerDocument;
      return true;
    };

    const releaseDocument = () => {
      if (ownedDocument && HIGHLIGHT_OWNERS.get(ownedDocument) === ownerToken) {
        HIGHLIGHT_OWNERS.delete(ownedDocument);
      }
      ownedDocument = null;
    };

    const clear = () => {
      if (
        activeRegistry &&
        (!ownedDocument || HIGHLIGHT_OWNERS.get(ownedDocument) === ownerToken)
      ) {
        activeRegistry.delete(HIGHLIGHT_NAME);
      }
      activeRegistry = undefined;
      activeRoot?.removeAttribute('data-page-rewrite-selection-highlight');
      activeRoot = null;
      activeOverlay.forEach((node) => node.remove());
      activeOverlay = [];
      activeBlockElements.forEach((node) =>
        node.removeAttribute('data-page-rewrite-block-selected'),
      );
      activeBlockElements = [];
      ownedStyle?.remove();
      ownedStyle = null;
      releaseDocument();
    };

    const observeRoot = (root: HTMLElement | null) => {
      if (observedRoot === root) return;
      mutationObserver?.disconnect();
      observedRoot = root;
      if (root && typeof MutationObserver !== 'undefined') {
        mutationObserver = new MutationObserver(() => scheduleRefresh());
        mutationObserver.observe(root, {
          characterData: true,
          childList: true,
          subtree: true,
        });
      }
    };

    const getTargets = (): RewriteSelectionHighlightTarget[] => {
      const targets = [...(selections ?? [])];
      if (selection) targets.push({ selection });
      if (continuationTarget) {
        targets.unshift({
          ...continuationTarget,
          provenanceOnly: Boolean(continuationTarget.sessionId),
        });
      }

      const deduplicated: RewriteSelectionHighlightTarget[] = [];
      const targetIndexes = new Map<string, number>();
      for (const target of targets) {
        const identity = getRewriteSelectionIdentity(target.selection);
        if (!identity) {
          deduplicated.push(target);
          continue;
        }

        const existingIndex = targetIndexes.get(identity);
        if (existingIndex !== undefined) {
          const existing = deduplicated[existingIndex];
          // Preserve one visual target, but let a live writing request carry
          // its session metadata so provenance wins over the stale quote.
          if (existing?.provenanceOnly && existing.sessionId) continue;
          if (
            target.status === 'writing' &&
            target.sessionId &&
            existing &&
            existing.status !== 'writing'
          ) {
            deduplicated[existingIndex] = target;
          }
          continue;
        }

        targetIndexes.set(identity, deduplicated.length);
        deduplicated.push(target);
      }
      return deduplicated;
    };

    const removeLayoutListeners = () => {
      layoutListenerCleanups.forEach((cleanup) => cleanup());
      layoutListenerCleanups = [];
      layoutVisualViewport = null;
      layoutOwnerWindow = null;
      layoutRoot = null;
    };

    const isScrollableElement = (element: HTMLElement, ownerWindow: BrowserWindow): boolean => {
      if (element.hasAttribute('data-page-editor-scroll-container')) return true;

      const style = ownerWindow.getComputedStyle(element);
      return /hidden|clip|auto|scroll|overlay/.test(
        [style.overflow, style.overflowX, style.overflowY].join(' '),
      );
    };

    const bindLayoutListeners = (root: HTMLElement) => {
      const ownerWindow = root.ownerDocument.defaultView as BrowserWindow | null;
      if (!ownerWindow || (layoutOwnerWindow === ownerWindow && layoutRoot === root)) return;

      removeLayoutListeners();
      layoutOwnerWindow = ownerWindow;
      layoutRoot = root;
      layoutListenerCleanups.push(
        addEventListenerWithCleanup(layoutOwnerWindow, 'resize', scheduleRefresh),
      );

      const scrollTargets: Array<{ capture: boolean; target: EventTarget }> = [
        // Keep the capture listener for document/window scrolling and for
        // scroll containers that are inserted above the editor after mount.
        { capture: true, target: layoutOwnerWindow },
      ];
      let current: HTMLElement | null = root;
      while (current) {
        if (isScrollableElement(current, layoutOwnerWindow)) {
          scrollTargets.push({ capture: false, target: current });
        }
        current = current.parentElement;
      }

      layoutVisualViewport = layoutOwnerWindow.visualViewport ?? null;
      if (layoutVisualViewport) {
        layoutListenerCleanups.push(
          addEventListenerWithCleanup(layoutVisualViewport, 'resize', scheduleRefresh),
          addEventListenerWithCleanup(layoutVisualViewport, 'scroll', scheduleRefresh, {
            passive: true,
          }),
        );
      }
      for (const target of scrollTargets) {
        layoutListenerCleanups.push(
          addEventListenerWithCleanup(target.target, 'scroll', scheduleRefresh, {
            capture: target.capture,
            passive: true,
          }),
        );
      }
    };

    const scheduleRefresh = () => {
      if (disposed || animationFrame !== undefined) return;
      const browserWindow =
        layoutOwnerWindow ??
        (editor.getRootElement?.()?.ownerDocument.defaultView as BrowserWindow);
      if (browserWindow?.requestAnimationFrame) {
        animationFrame = browserWindow.requestAnimationFrame(refresh);
      } else {
        refresh();
      }
    };

    const resolveTargets = (targets: readonly RewriteSelectionHighlightTarget[]): Range[] => {
      const resolved: Range[] = [];
      const seenRangeKeys = new Set<string>();
      const provenanceSessions = new Set<string>();

      const appendRange = (range: Range, key: string) => {
        if (seenRangeKeys.has(key)) return;
        seenRangeKeys.add(key);
        resolved.push(range);
      };

      for (const target of targets) {
        // Node rewrites are occupied through collaborative target leases. They
        // must never become a text highlight or provenance range: a session's
        // generated DOM may span the node (and adjacent siblings) while it is
        // being written.
        if (isNodeRewriteSelection(target.selection)) continue;

        if ((target.status === 'writing' || target.provenanceOnly) && target.sessionId) {
          if (provenanceSessions.has(target.sessionId)) continue;
          const provenance = resolveAISessionRanges(editor, target.sessionId);
          if (provenance.hasProvenance) {
            provenanceSessions.add(target.sessionId);
            provenance.ranges.forEach((range, index) => {
              appendRange(range, `provenance\u0000${target.sessionId}\u0000${index}`);
            });
            // A live provenance row is authoritative even while the generated
            // text differs from the original quote. Do not hash-fail back to
            // the stale request selection.
            continue;
          }
        }

        if (target.provenanceOnly && target.sessionId) continue;

        if (!isDurableSelection(target.selection)) continue;
        const range = resolveSelectionRange(editor, target.selection);
        if (range) {
          appendRange(
            range,
            `selection\u0000${getRewriteSelectionIdentity(target.selection) ?? ''}`,
          );
        }
      }

      return resolved;
    };

    const refresh = () => {
      animationFrame = undefined;
      if (disposed) return;

      clear();
      const root = editor.getRootElement?.() ?? null;
      observeRoot(root);
      if (!root) {
        removeLayoutListeners();
        return;
      }
      bindLayoutListeners(root);
      if (!ownsDocument(root.ownerDocument)) return;

      const targets = getTargets();
      activeBlockElements = [
        ...new Set(
          targets.flatMap((target) => {
            if (!isNodeRewriteSelection(target.selection)) return [];
            const element = resolveNodeSelectionElement(editor, target.selection!);
            return element ? [element] : [];
          }),
        ),
      ];
      for (const element of activeBlockElements)
        element.setAttribute('data-page-rewrite-block-selected', 'true');
      if (activeBlockElements.length > 0) {
        activeRoot = root;
        root.setAttribute('data-page-rewrite-selection-highlight', 'block');
      }
      const ranges = resolveTargets(targets);
      if (ranges.length === 0) return;

      const ownerDocument = root.ownerDocument;
      const browserWindow = ownerDocument.defaultView as BrowserWindow | null;
      const registry = browserWindow?.CSS?.highlights;
      const HighlightConstructor = browserWindow?.Highlight;
      ownedStyle = ensureHighlightStyle(ownerDocument);

      // A continuation target must remain visible even when another editor
      // service owns or replaces the CSS Highlight registry during a refresh.
      // Its absolute overlays are scoped to the editor's containing block, so
      // page and ancestor scrolling move the overlay with the text. They are
      // also refreshed for nested scroll containers and visual-viewport zoom.
      const forceContinuationOverlay = Boolean(continuationTarget);
      if (!forceContinuationOverlay && registry && HighlightConstructor) {
        // One CSS Highlight object may contain any number of ranges. Keeping
        // this registration centralized avoids instances racing on the same
        // global highlight name when several requests are active.
        registry.set(HIGHLIGHT_NAME, new HighlightConstructor(...ranges));
        activeRegistry = registry;
        activeRoot = root;
        root.setAttribute('data-page-rewrite-selection-highlight', 'css');
        return;
      }

      const overlayParent = getOverlayHost(root);
      activeOverlay = createOverlays(ownerDocument, overlayParent, root, ranges);
      activeOverlay.forEach((node) => overlayParent.append(node));
      activeRoot = root;
      root.setAttribute('data-page-rewrite-selection-highlight', 'overlay');
    };

    const lexicalEditor = editor.getLexicalEditor?.();
    const unregisterUpdate = lexicalEditor?.registerUpdateListener(() => scheduleRefresh());
    const unregisterRoot = lexicalEditor?.registerRootListener((root) => {
      observeRoot(root);
      scheduleRefresh();
    });
    const initializedListener = () => scheduleRefresh();
    editor.on?.('initialized', initializedListener);
    const provenanceService = editor.requireService(IAISessionService);
    const unregisterProvenance = provenanceService?.subscribe?.(() => scheduleRefresh());

    refresh();

    return () => {
      disposed = true;
      if (animationFrame !== undefined) {
        layoutOwnerWindow?.cancelAnimationFrame(animationFrame);
      }
      unregisterUpdate?.();
      unregisterRoot?.();
      unregisterProvenance?.();
      mutationObserver?.disconnect();
      editor.off?.('initialized', initializedListener);
      removeLayoutListeners();
      clear();
    };
  }, [continuationTarget, editor, selection, selections]);

  return null;
};

RewriteSelectionHighlightPlugin.displayName = 'RewriteSelectionHighlightPlugin';

export { createDOMRange, resolveSelectionRange };
export default RewriteSelectionHighlightPlugin;

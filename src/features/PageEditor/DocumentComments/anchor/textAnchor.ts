import type { DocumentCommentSelectionAnchor } from '@lobechat/types';

/** Kept in sync with the router's `selectionAnchorSchema`. */
export const ANCHOR_QUOTE_MAX_LENGTH = 2000;
export const ANCHOR_CONTEXT_LENGTH = 100;

/**
 * Cap on how many identical occurrences of a quote are scored. Past this the
 * quote is repeated so often that context cannot single one out, and the
 * scan reports the anchor lost rather than picking an arbitrary hit.
 */
const MAX_CANDIDATES = 2000;

/**
 * Elements that start a new line of running text. The flattened text inserts a
 * `\n` at their boundaries so two adjacent paragraphs never concatenate into a
 * word that exists in neither ("Hello" + "World" -> "HelloWorld"), which would
 * otherwise produce quotes that read as gibberish and context windows that
 * match the wrong run.
 */
const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DETAILS',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TD',
  'TH',
  'TR',
  'UL',
]);

/** Never contribute rendered text. */
const SKIPPED_TAGS = new Set(['NOSCRIPT', 'SCRIPT', 'STYLE', 'TEMPLATE']);

interface TextSegment {
  /** Exclusive offset of this node's last character in {@link FlattenedText.text}. */
  end: number;
  node: Text;
  /** Offset of this node's first character in {@link FlattenedText.text}. */
  start: number;
}

export interface FlattenedText {
  /** In document order. Synthetic block separators live *between* segments and belong to none. */
  segments: TextSegment[];
  text: string;
}

export interface AnchorMatch {
  end: number;
  start: number;
}

export const EMPTY_FLATTENED_TEXT: FlattenedText = { segments: [], text: '' };

/**
 * Flatten the rendered body into one string plus a DOM index, so an anchor can
 * be expressed as plain character offsets.
 *
 * Reading the DOM rather than the Lexical editor state is deliberate: the same
 * walk serves capture, re-location and range painting, so all three agree by
 * construction, and none of them depends on node keys that the editor throws
 * away on every load.
 */
export const flattenEditorText = (root: HTMLElement | null | undefined): FlattenedText => {
  if (!root) return EMPTY_FLATTENED_TEXT;

  const segments: TextSegment[] = [];
  let text = '';

  const pushBreak = () => {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n';
  };

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node as Text).data;
      if (!value) return;
      segments.push({ end: text.length + value.length, node: node as Text, start: text.length });
      text += value;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;
    if (SKIPPED_TAGS.has(element.tagName)) return;
    if (element.tagName === 'BR') {
      pushBreak();
      return;
    }

    const isBlock = BLOCK_TAGS.has(element.tagName);
    if (isBlock) pushBreak();
    for (const child of element.childNodes) visit(child);
    if (isBlock) pushBreak();
  };

  visit(root);

  return { segments, text };
};

const isWhitespace = (value: string | undefined) => Boolean(value) && /\s/.test(value!);

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** True when cutting the string at `index` would leave half a surrogate pair. */
const splitsSurrogatePair = (text: string, index: number) =>
  index > 0 &&
  index < text.length &&
  isHighSurrogate(text.charCodeAt(index - 1)) &&
  isLowSurrogate(text.charCodeAt(index));

/**
 * Nudge a slice boundary off the middle of a surrogate pair.
 *
 * An anchor is stored as JSONB, and Postgres rejects a string containing a lone
 * surrogate — so a prefix window that happens to start halfway through an emoji
 * would fail the whole insert. `direction` says which way the boundary may move
 * without eating into the text the caller actually wants.
 */
const safeBoundary = (text: string, index: number, direction: -1 | 1) =>
  splitsSurrogatePair(text, index) ? index + direction : index;

/** Offset of the first character contributed by `node` or anything after it. */
const offsetAtStartOf = (flat: FlattenedText, node: Node): number => {
  for (const segment of flat.segments) {
    if (segment.node === node) return segment.start;
    const position = node.compareDocumentPosition(segment.node);
    if (
      position & Node.DOCUMENT_POSITION_CONTAINED_BY ||
      position & Node.DOCUMENT_POSITION_FOLLOWING
    )
      return segment.start;
  }
  return flat.text.length;
};

/** Offset just past the last character contributed by `node` or anything before it. */
const offsetAtEndOf = (flat: FlattenedText, node: Node): number => {
  let offset = 0;
  for (const segment of flat.segments) {
    if (segment.node === node) {
      offset = segment.end;
      continue;
    }
    const position = node.compareDocumentPosition(segment.node);
    if (
      position & Node.DOCUMENT_POSITION_CONTAINED_BY ||
      position & Node.DOCUMENT_POSITION_PRECEDING
    ) {
      offset = segment.end;
      continue;
    }
    break;
  }
  return offset;
};

/** Turn a DOM boundary point into a flattened-text offset. */
export const pointToOffset = (
  flat: FlattenedText,
  container: Node,
  containerOffset: number,
): number => {
  if (container.nodeType === Node.TEXT_NODE) {
    const segment = flat.segments.find(({ node }) => node === container);
    if (segment) return Math.min(segment.start + containerOffset, segment.end);
    // An empty text node contributes nothing, so fall back to its position.
    return offsetAtStartOf(flat, container);
  }

  const child = container.childNodes[containerOffset];
  return child ? offsetAtStartOf(flat, child) : offsetAtEndOf(flat, container);
};

interface DomPoint {
  node: Text;
  offset: number;
}

/**
 * Turn a flattened-text offset back into a DOM point. An offset that lands on a
 * synthetic block separator belongs to no text node, so it is clamped towards
 * the inside of the run: forward for a start edge, backward for an end edge.
 */
const offsetToPoint = (
  flat: FlattenedText,
  offset: number,
  edge: 'end' | 'start',
): DomPoint | null => {
  const { segments } = flat;
  if (segments.length === 0) return null;

  if (edge === 'start') {
    for (const segment of segments) {
      if (offset < segment.start) return { node: segment.node, offset: 0 };
      if (offset <= segment.end) return { node: segment.node, offset: offset - segment.start };
    }
    const last = segments.at(-1)!;
    return { node: last.node, offset: last.node.data.length };
  }

  for (let index = segments.length - 1; index >= 0; index--) {
    const segment = segments[index];
    if (offset > segment.end) return { node: segment.node, offset: segment.node.data.length };
    if (offset >= segment.start) return { node: segment.node, offset: offset - segment.start };
  }
  const first = segments[0];
  return { node: first.node, offset: 0 };
};

export const buildAnchorRange = (flat: FlattenedText, match: AnchorMatch): Range | null => {
  const start = offsetToPoint(flat, match.start, 'start');
  const end = offsetToPoint(flat, match.end, 'end');
  if (!start || !end) return null;

  const range = start.node.ownerDocument.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
};

const commonSuffixLength = (left: string, right: string) => {
  let length = 0;
  while (
    length < left.length &&
    length < right.length &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  )
    length++;
  return length;
};

const commonPrefixLength = (left: string, right: string) => {
  let length = 0;
  while (length < left.length && length < right.length && left[length] === right[length]) length++;
  return length;
};

/**
 * Re-find an anchor in the current body.
 *
 * The stored offsets are only a hint — any edit above the quote shifts them —
 * so they are checked first (the common, unedited case, and free) and then
 * demoted to a tie-breaker between candidates that the surrounding text can't
 * separate. Context agreement always outranks position: the distance term is
 * normalised below 1 so it can never outvote a single matching character of
 * prefix or suffix.
 *
 * Returns `null` when the quoted run no longer exists — the caller renders the
 * comment as orphaned rather than guessing at a different run.
 */
export const locateAnchor = (
  flat: FlattenedText,
  anchor: DocumentCommentSelectionAnchor,
): AnchorMatch | null => {
  const { prefix = '', quote, start, suffix = '' } = anchor;
  if (!quote) return null;
  if (!flat.text) return null;

  const fullContext = prefix.length + suffix.length;
  const contextScore = (index: number) => {
    const before = flat.text.slice(Math.max(0, index - prefix.length), index);
    const after = flat.text.slice(index + quote.length, index + quote.length + suffix.length);
    return commonSuffixLength(before, prefix) + commonPrefixLength(after, suffix);
  };

  // Fast path for the untouched document. The context has to agree too: an
  // identical phrase that happens to land on the stored offset — say the reader
  // duplicated the paragraph above — is a different sentence, not this one.
  if (
    flat.text.slice(start, start + quote.length) === quote &&
    contextScore(start) === fullContext
  ) {
    return { end: start + quote.length, start };
  }

  let best: number | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestContext = -1;
  let seen = 0;
  let truncated = false;

  // Occurrences are visited outwards from the stored offset rather than from
  // the top of the document, so the candidate cap can only ever discard the
  // furthest repetitions — scanning top-down would spend the whole budget
  // before reaching the one the reader actually annotated.
  let forward = flat.text.indexOf(quote, start);
  let backward = start > 0 ? flat.text.lastIndexOf(quote, start - 1) : -1;

  while (forward !== -1 || backward !== -1) {
    if (seen >= MAX_CANDIDATES) {
      truncated = true;
      break;
    }
    const takeForward =
      backward === -1 ||
      (forward !== -1 && Math.abs(forward - start) <= Math.abs(backward - start));
    const index = takeForward ? forward : backward;
    if (takeForward) forward = flat.text.indexOf(quote, forward + 1);
    else backward = backward === 0 ? -1 : flat.text.lastIndexOf(quote, backward - 1);

    seen++;
    const context = contextScore(index);
    const score = context - Math.abs(index - start) / (flat.text.length + 1);

    if (score > bestScore) {
      bestScore = score;
      bestContext = context;
      best = index;
    }
  }

  if (best === null) return null;
  // The scan stopped early and nothing matched its stored context outright, so
  // the right occurrence may well be one we never looked at. Report the anchor
  // lost instead of pointing the comment at a arbitrary repetition.
  if (truncated && bestContext < fullContext) return null;
  return { end: best + quote.length, start: best };
};

/**
 * Read a DOM range inside the body as an anchor.
 *
 * Whitespace at either edge is dropped before the quote is taken so a sloppy
 * double-click ("word ") doesn't bake a trailing space into the text every
 * future re-location has to reproduce. Returns `null` for a range outside the
 * body or one that is whitespace only.
 */
export const captureRangeAnchor = (
  root: HTMLElement | null | undefined,
  range: Range | null | undefined,
): DocumentCommentSelectionAnchor | null => {
  if (!root || !range) return null;
  if (!root.contains(range.commonAncestorContainer)) return null;

  const flat = flattenEditorText(root);
  if (!flat.text) return null;

  let start = pointToOffset(flat, range.startContainer, range.startOffset);
  let end = pointToOffset(flat, range.endContainer, range.endOffset);
  if (end < start) [start, end] = [end, start];

  while (start < end && isWhitespace(flat.text[start])) start++;
  while (end > start && isWhitespace(flat.text[end - 1])) end--;

  // Every window below is cut to a fixed length, which can land halfway through
  // an astral character. Snap each boundary inwards first: the anchor is stored
  // as JSONB and a lone surrogate would fail the insert outright.
  start = safeBoundary(flat.text, start, 1);
  end = safeBoundary(flat.text, end, -1);
  if (end <= start) return null;

  if (end - start > ANCHOR_QUOTE_MAX_LENGTH) {
    end = safeBoundary(flat.text, start + ANCHOR_QUOTE_MAX_LENGTH, -1);
  }
  if (end <= start) return null;

  const prefixStart = safeBoundary(flat.text, Math.max(0, start - ANCHOR_CONTEXT_LENGTH), 1);
  const suffixEnd = safeBoundary(
    flat.text,
    Math.min(flat.text.length, end + ANCHOR_CONTEXT_LENGTH),
    -1,
  );

  return {
    end,
    prefix: flat.text.slice(prefixStart, start),
    quote: flat.text.slice(start, end),
    start,
    suffix: flat.text.slice(end, suffixEnd),
  };
};

/** Read the reader's current selection as an anchor; `null` when it is collapsed. */
export const captureSelectionAnchor = (
  root: HTMLElement | null | undefined,
): DocumentCommentSelectionAnchor | null => {
  if (!root) return null;
  const selection = root.ownerDocument.defaultView?.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  return captureRangeAnchor(root, selection.getRangeAt(0));
};

/** Which flattened-text offset sits under a viewport point, or `null` when it is outside the body. */
export const offsetFromClientPoint = (
  root: HTMLElement,
  flat: FlattenedText,
  clientX: number,
  clientY: number,
): number | null => {
  const doc = root.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offset: number; offsetNode: Node } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const position = doc.caretPositionFromPoint?.(clientX, clientY);
  if (position?.offsetNode) {
    if (!root.contains(position.offsetNode)) return null;
    return pointToOffset(flat, position.offsetNode, position.offset);
  }

  const caretRange = doc.caretRangeFromPoint?.(clientX, clientY);
  if (!caretRange || !root.contains(caretRange.startContainer)) return null;
  return pointToOffset(flat, caretRange.startContainer, caretRange.startOffset);
};

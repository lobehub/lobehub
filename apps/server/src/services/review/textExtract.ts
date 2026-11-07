import type { DocumentReviewTextAnchor } from '@lobechat/types';

/**
 * Plain-text projection of a document body.
 *
 * Rule checks run against text, not editor JSON: the model must quote a
 * contiguous fragment, and evidence anchors are located by exact substring
 * match. Keeping the projection here (rather than reusing the editor's Markdown
 * export) means the text the model reads is byte-identical to the text the
 * server locates quotes in — no `**` / `#` markers that a model would silently
 * drop.
 */

interface SerializedNode {
  children?: SerializedNode[];
  text?: string;
  type?: string;
}

/** Node types that terminate a line of text when closed. */
const BLOCK_NODE_TYPES = new Set([
  'code',
  'heading',
  'horizontalrule',
  'list',
  'listitem',
  'paragraph',
  'quote',
  'table',
  'tablecell',
  'tablerow',
]);

const isSerializedNode = (value: unknown): value is SerializedNode =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeText = (text: string): string =>
  text
    .replaceAll('\r\n', '\n')
    .replaceAll(/[ \t]+\n/g, '\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Flatten Lexical `editorData` into plain text. Text nodes are concatenated in
 * document order; block boundaries become newlines; `linebreak` becomes `\n`.
 */
export const textFromEditorData = (editorData: unknown): string => {
  if (!isSerializedNode(editorData)) return '';
  const root = (editorData as { root?: SerializedNode }).root;
  if (!isSerializedNode(root)) return '';

  const parts: string[] = [];

  const walk = (node: SerializedNode) => {
    if (node.type === 'text' && typeof node.text === 'string') {
      parts.push(node.text);
      return;
    }
    if (node.type === 'linebreak') {
      parts.push('\n');
      return;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (isSerializedNode(child)) walk(child);
      }
    }
    if (node.type && BLOCK_NODE_TYPES.has(node.type)) parts.push('\n');
  };

  walk(root);
  return normalizeText(parts.join(''));
};

/** The document body as plain text, falling back to Markdown `content`. */
export const extractDocumentText = (params: {
  content?: string | null;
  editorData?: unknown;
}): string => {
  const fromEditor = textFromEditorData(params.editorData);
  if (fromEditor.length > 0) return fromEditor;
  return normalizeText(params.content ?? '');
};

export interface LocatedQuote {
  anchor: DocumentReviewTextAnchor;
  start: number;
}

const countOccurrences = (text: string, needle: string): number => {
  if (!needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
};

/**
 * Locate a quote in the plain text. The model's offsets are never trusted; only
 * the quote itself is. Surrounding whitespace is trimmed because models add it,
 * but the stored anchor keeps the exact matched substring.
 */
export const locateQuote = (text: string, quote: string, label?: string): LocatedQuote | null => {
  const needle = quote.trim();
  if (!needle) return null;

  const start = text.indexOf(needle);
  if (start === -1) return null;

  return {
    anchor: {
      end: start + needle.length,
      label,
      quote: needle,
      start,
    },
    start,
  };
};

export const countQuoteOccurrences = (text: string, quote: string): number =>
  countOccurrences(text, quote.trim());

/** Context window around a quote, used by the suggestion prompt. */
export const quoteContext = (
  text: string,
  quote: string,
  radius = 200,
): { after: string; before: string } => {
  const located = locateQuote(text, quote);
  if (!located) return { after: '', before: '' };
  const start = located.start;
  const end = start + located.anchor.quote.length;

  return {
    after: text.slice(end, end + radius),
    before: text.slice(Math.max(0, start - radius), start),
  };
};

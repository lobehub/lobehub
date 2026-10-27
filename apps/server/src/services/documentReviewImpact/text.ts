import type { DocumentReviewTextAnchor } from '@lobechat/types';

/**
 * Plain-text projection of a document body and text-quote anchoring.
 *
 * Impact items are stored as text selectors (`quote` plus a little
 * `prefix`/`suffix`) instead of editor node ids: Lexical regenerates node keys
 * on every save, while the quoted wording is stable — and when it is not, the
 * quote itself is the excerpt the reviewer still needs to see.
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

export const normalizeText = (text: string): string =>
  text
    .replaceAll('\r\n', '\n')
    .replaceAll(/[ \t]+\n/g, '\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();

/** Flatten Lexical `editorData` into the plain text the model reads. */
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

/**
 * The body as plain text. Editor state wins so baseline and current text go
 * through the same projection; Markdown `content` is the fallback for
 * documents without editor state (CLI writes, imports).
 */
export const extractDocumentText = (params: {
  content?: string | null;
  editorData?: unknown;
}): string => {
  const fromEditor = textFromEditorData(params.editorData);
  if (fromEditor.length > 0) return fromEditor;
  return normalizeText(params.content ?? '');
};

const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Models transliterate CJK punctuation (`，` → `,`, `“` → `"`) when they copy a
 * quote. Fold those characters to one canonical form for *matching only* — the
 * mapping is 1:1, so a match index is still a valid offset into the original
 * text and the stored quote keeps the document's own punctuation.
 */
const PUNCTUATION_FOLD: Record<string, string> = {
  '，': ',',
  '、': ',',
  '；': ';',
  '：': ':',
  '（': '(',
  '）': ')',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '！': '!',
  '？': '?',
  '．': '.',
  '－': '-',
  '％': '%',
  '　': ' ',
};

const foldPunctuation = (value: string): string =>
  value.replaceAll(/[，、；：（）“”‘’！？．－％\u3000]/g, (char) => PUNCTUATION_FOLD[char] ?? char);

export interface QuoteMatch {
  end: number;
  start: number;
}

const CONTEXT_RADIUS = 40;

/**
 * Find a quote in the body. Exact match first; then a punctuation-folded pass
 * and a whitespace-tolerant pass, because models routinely swap full-width
 * punctuation or turn a paragraph break inside a quote into a space. The
 * matched substring — not the model's version — becomes the stored `quote`, so
 * a later relocation is an exact `indexOf` again.
 */
export const findQuote = (text: string, rawQuote: string): QuoteMatch | null => {
  const quote = normalizeText(rawQuote);
  if (!quote) return null;

  const exact = text.indexOf(quote);
  if (exact !== -1) return { end: exact + quote.length, start: exact };

  const foldedText = foldPunctuation(text);
  const foldedQuote = foldPunctuation(quote);
  const folded = foldedText.indexOf(foldedQuote);
  if (folded !== -1) return { end: folded + foldedQuote.length, start: folded };

  const parts = foldedQuote.split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (parts.length >= 2) {
    const relaxed = new RegExp(parts.join('\\s+'));
    const match = relaxed.exec(foldedText);
    if (match) return { end: match.index + match[0].length, start: match.index };
  }

  return compactMatch(text, quote);
};

/** Characters ignored by the last-resort match (whitespace and punctuation). */
const IGNORABLE = /[\s，。、；：（）()“”"'‘’！？!?.,;:…\-—_]/;

const compact = (value: string): { map: number[]; text: string } => {
  const map: number[] = [];
  let text = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (IGNORABLE.test(char)) continue;
    map.push(index);
    text += char.toLowerCase();
  }
  return { map, text };
};

/**
 * Last resort: match ignoring all punctuation and whitespace, so a model that
 * drops a comma or a full stop still points at the right passage. The offset
 * map converts the compact match back to the original text, and the stored
 * quote is the original substring (punctuation included).
 */
const compactMatch = (text: string, quote: string): QuoteMatch | null => {
  const compactText = compact(text);
  const compactQuote = compact(quote);
  if (compactQuote.text.length < 4) return null;

  const index = compactText.text.indexOf(compactQuote.text);
  if (index === -1) return null;

  return {
    end: compactText.map[index + compactQuote.text.length - 1] + 1,
    start: compactText.map[index],
  };
};

/**
 * Build a persistable anchor. Returns null when the quote is not in the body —
 * the caller decides whether to drop the item (it must not) or keep it as an
 * invalid anchor.
 */
export const buildAnchor = (
  text: string,
  rawQuote: string,
  label?: string,
): DocumentReviewTextAnchor | null => {
  const match = findQuote(text, rawQuote);
  if (!match) return null;
  const quote = text.slice(match.start, match.end);

  return {
    end: match.end,
    label,
    prefix: text.slice(Math.max(0, match.start - CONTEXT_RADIUS), match.start),
    quote,
    start: match.start,
    suffix: text.slice(match.end, match.end + CONTEXT_RADIUS),
  };
};

export type AnchorResolution =
  { status: 'invalid' } | { end: number; start: number; status: 'located' };

/**
 * Re-locate a stored anchor in the current body. Prefix/suffix narrow the
 * search first, so a repeated quote lands where it was captured.
 */
export const resolveAnchor = (text: string, anchor: DocumentReviewTextAnchor): AnchorResolution => {
  const quote = normalizeText(anchor.quote ?? '');
  if (!quote) return { status: 'invalid' };

  if (anchor.prefix || anchor.suffix) {
    const withContext = `${anchor.prefix ?? ''}${quote}${anchor.suffix ?? ''}`;
    const contextMatch = text.indexOf(withContext);
    if (contextMatch !== -1) {
      const start = contextMatch + (anchor.prefix?.length ?? 0);
      return { end: start + quote.length, start, status: 'located' };
    }
  }

  const match = findQuote(text, quote);
  return match ? { ...match, status: 'located' } : { status: 'invalid' };
};

export interface AnchorContext {
  after: string;
  before: string;
  quote: string;
  status: 'invalid' | 'located';
}

/** Quote plus its surrounding text, for prompts and the UI excerpt. */
export const anchorContext = (
  text: string,
  anchor: DocumentReviewTextAnchor,
  radius = 160,
): AnchorContext => {
  const resolved = resolveAnchor(text, anchor);
  if (resolved.status === 'invalid') {
    return { after: '', before: '', quote: normalizeText(anchor.quote ?? ''), status: 'invalid' };
  }

  return {
    after: text.slice(resolved.end, resolved.end + radius),
    before: text.slice(Math.max(0, resolved.start - radius), resolved.start),
    quote: text.slice(resolved.start, resolved.end),
    status: 'located',
  };
};

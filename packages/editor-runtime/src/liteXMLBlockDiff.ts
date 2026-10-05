import type { ModifyOperation } from './types';

type Token =
  | { kind: 'close'; raw: string; tag: string }
  | { kind: 'open' | 'self'; raw: string; tag: string }
  | { kind: 'text'; raw: string; verbatim: boolean };

export interface LiteXMLBlock {
  id?: string;
  tag: string;
  text: string;
  xml: string;
}

export interface LiteXMLBlockDiffSummary {
  inserted: number;
  modified: number;
  removed: number;
}

export type LiteXMLBlockDiffResult =
  | { ok: true; operations: ModifyOperation[]; summary: LiteXMLBlockDiffSummary }
  | { ok: false; reason: string };

const TAG = /<(\/?)([a-z][\w-]*)(?:\s+[\w:-]+(?:="[^"]*")?)*\s*(\/?)>/iy;
const ID_ATTRIBUTE = /\bid="([^"]+)"/;
// The LiteXML exporter writes text inside these elements without escaping `<`.
const VERBATIM_TAGS = new Set(['code', 'span']);

const tokenize = (litexml: string): Token[] => {
  const tokens: Token[] = [];
  let text = '';
  let i = 0;

  const flushText = () => {
    if (text) tokens.push({ kind: 'text', raw: text, verbatim: false });
    text = '';
  };

  while (i < litexml.length) {
    if (litexml[i] !== '<') {
      text += litexml[i];
      i += 1;
      continue;
    }
    if (litexml.startsWith('<?', i) || litexml.startsWith('<!--', i)) {
      const close = litexml.startsWith('<?', i) ? '?>' : '-->';
      const end = litexml.indexOf(close, i);
      i = end === -1 ? litexml.length : end + close.length;
      continue;
    }

    TAG.lastIndex = i;
    const match = TAG.exec(litexml);
    if (!match) {
      text += '<';
      i += 1;
      continue;
    }

    flushText();
    const [raw, closing, tag, selfClosing] = match;
    i += raw.length;
    if (closing) {
      tokens.push({ kind: 'close', raw, tag });
      continue;
    }
    if (selfClosing) {
      tokens.push({ kind: 'self', raw, tag });
      continue;
    }
    tokens.push({ kind: 'open', raw, tag });

    if (VERBATIM_TAGS.has(tag)) {
      const closeTag = `</${tag}>`;
      const end = litexml.indexOf(closeTag, i);
      // The exporter keeps span text on one line; a span that runs past a newline lost its
      // `</span>`, and scanning on would swallow the next block's markup as text.
      if (end === -1 || (tag === 'span' && litexml.slice(i, end).includes('\n'))) continue;
      if (end > i) tokens.push({ kind: 'text', raw: litexml.slice(i, end), verbatim: true });
      tokens.push({ kind: 'close', raw: closeTag, tag });
      i = end + closeTag.length;
    }
  }
  flushText();

  return tokens;
};

const isLayoutWhitespace = (token: Token) =>
  token.kind === 'text' && !token.verbatim && /^\s*$/.test(token.raw) && token.raw.includes('\n');

const serialize = (tokens: Token[]) =>
  tokens
    .filter((token) => !isLayoutWhitespace(token))
    .map((token) => token.raw)
    .join('')
    .trim();

const escapeText = (text: string) =>
  text
    .replaceAll(/&(?!#?\w+;)/g, '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

// The editor imports LiteXML with DOMParser (so text must be escaped) and drops
// whitespace-only text nodes unless they sit in a <text> element.
const toPayload = (tokens: Token[], { stripIds = false } = {}) =>
  tokens
    .filter((token) => !isLayoutWhitespace(token))
    .map((token) => {
      if (token.kind === 'text') {
        const text = escapeText(token.raw);
        return /^\s+$/.test(token.raw) ? `<text>${text}</text>` : text;
      }
      return stripIds ? token.raw.replaceAll(/\s+id="[^"]*"/g, '') : token.raw;
    })
    .join('')
    .trim();

const blockText = (tokens: Token[]) =>
  tokens
    .filter((token) => token.kind === 'text')
    .map((token) => token.raw)
    .join('')
    .replaceAll(/\s+/g, ' ')
    .trim();

interface ParsedBlock extends LiteXMLBlock {
  tokens: Token[];
}

const parseBlocks = (litexml: string): ParsedBlock[] | string => {
  const tokens = tokenize(litexml);
  const rootIndex = tokens.findIndex(
    (token) => token.kind !== 'text' && token.kind !== 'close' && token.tag === 'root',
  );
  if (rootIndex === -1) return 'missing <root> element';
  if (tokens.slice(0, rootIndex).some((token) => token.raw.trim())) {
    return 'content before <root>';
  }
  if (tokens[rootIndex].kind === 'self') {
    return tokens.slice(rootIndex + 1).some((token) => token.raw.trim())
      ? 'content after </root>'
      : [];
  }

  const blocks: ParsedBlock[] = [];
  const stack: string[] = [];
  let current: Token[] = [];

  for (let index = rootIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (stack.length === 0) {
      if (token.kind === 'text') {
        if (token.raw.trim()) return 'text outside a block under <root>';
        continue;
      }
      if (token.kind === 'close') {
        if (token.tag !== 'root') return `unexpected </${token.tag}> under <root>`;
        if (tokens.slice(index + 1).some((rest) => rest.raw.trim())) {
          return 'content after </root>; put new blocks inside <root>';
        }
        return blocks;
      }
    }

    current.push(token);
    if (token.kind === 'open') stack.push(token.tag);
    if (token.kind === 'close') {
      const open = stack.pop();
      if (open !== token.tag) return `</${token.tag}> does not close <${open}>`;
    }

    if (stack.length === 0) {
      const head = current[0] as Extract<Token, { tag: string }>;
      blocks.push({
        id: head.raw.match(ID_ATTRIBUTE)?.[1],
        tag: head.tag,
        text: blockText(current),
        tokens: current,
        xml: serialize(current),
      });
      current = [];
    }
  }

  return stack.length > 0 ? `<${stack.at(-1)}> is never closed` : 'missing </root>';
};

export const parseLiteXMLBlocks = (litexml: string): LiteXMLBlock[] | string => {
  const blocks = parseBlocks(litexml);
  return typeof blocks === 'string'
    ? blocks
    : blocks.map(({ id, tag, text, xml }) => ({ id, tag, text, xml }));
};

const longestCommonSubsequence = (a: string[], b: string[]): Set<string> => {
  const common = new Set<string>();

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    common.add(a[start]);
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    common.add(a[endA - 1]);
    endA -= 1;
    endB -= 1;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const lengths = Array.from({ length: midA.length + 1 }, () => new Int32Array(midB.length + 1));
  for (let i = midA.length - 1; i >= 0; i -= 1) {
    for (let j = midB.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        midA[i] === midB[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      common.add(midA[i]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) i += 1;
    else j += 1;
  }
  return common;
};

export const diffLiteXMLBlocks = (original: string, edited: string): LiteXMLBlockDiffResult => {
  const before = parseBlocks(original);
  if (typeof before === 'string') return { ok: false, reason: `original document: ${before}` };
  if (before.length === 0) {
    return { ok: false, reason: 'the page is empty; call the initPage tool with Markdown instead' };
  }
  const after = parseBlocks(edited);
  if (typeof after === 'string') return { ok: false, reason: after };

  const originalIds = before.flatMap((block) => (block.id ? [block.id] : []));
  const originalById = new Map(before.map((block) => [block.id, block]));

  const editedIds = new Set(after.map((block) => block.id));
  const surviving = originalIds.filter((id) => editedIds.has(id)).length;
  const similarLength =
    Math.abs(after.length - before.length) <= Math.max(2, Math.ceil(before.length * 0.2));
  if (originalIds.length >= 2 && similarLength && surviving / originalIds.length < 0.5) {
    return {
      ok: false,
      reason:
        'most block ids were dropped. Keep the id attributes from /doc.xml when editing existing blocks, or call the initPage tool to replace the whole page',
    };
  }

  const seen = new Set<string>();
  const candidates = after.map((block) => {
    if (!block.id || !originalById.has(block.id) || seen.has(block.id)) return undefined;
    seen.add(block.id);
    return block.id;
  });
  const kept = longestCommonSubsequence(
    originalIds,
    candidates.filter((id): id is string => !!id),
  );

  const inserts: ModifyOperation[] = [];
  const modifies: ModifyOperation[] = [];
  let pending: string[] = [];
  let lastKeptId: string | undefined;
  let inserted = 0;

  const flush = (anchor: { afterId: string } | { beforeId: string }) => {
    if (pending.length === 0) return;
    inserted += pending.length;
    const litexml = pending.length === 1 ? pending[0] : `<root>${pending.join('')}</root>`;
    inserts.push({ action: 'insert', ...anchor, litexml });
    pending = [];
  };

  after.forEach((block, index) => {
    const id = candidates[index];
    if (!id || !kept.has(id)) {
      pending.push(toPayload(block.tokens, { stripIds: true }));
      return;
    }
    flush(lastKeptId ? { afterId: lastKeptId } : { beforeId: id });
    lastKeptId = id;
    if (block.xml !== originalById.get(id)!.xml) {
      modifies.push({ action: 'modify', litexml: toPayload(block.tokens) });
    }
  });
  flush({ afterId: lastKeptId ?? originalIds.at(-1)! });

  const removes: ModifyOperation[] = originalIds
    .filter((id) => !kept.has(id))
    .map((id) => ({ action: 'remove', id }));

  return {
    ok: true,
    operations: [...inserts, ...modifies, ...removes],
    summary: { inserted, modified: modifies.length, removed: removes.length },
  };
};

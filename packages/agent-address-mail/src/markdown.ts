/**
 * Minimal Markdown → HTML / plain-text rendering for outbound email.
 *
 * The adapter deliberately avoids pulling a Markdown pipeline into a package
 * that also runs in the browser-safe layer: outbound replies only need the
 * small subset the agent actually emits (headings, lists, code, links,
 * emphasis, quotes, rules). Unknown syntax degrades to escaped text.
 *
 * Both outputs are derived from the same token walk so the HTML and the text
 * alternative never disagree about the content.
 */

const escapeHtml = (input: string) =>
  input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** Inline spans. `href`-carrying rules run before emphasis so `*` inside a URL survives. */
const renderInline = (input: string): string => {
  let out = escapeHtml(input);

  out = out.replaceAll(/`([^`]+)`/g, (_, code: string) => `<code>${code}</code>`);
  out = out.replaceAll(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label: string, href: string) => `<a href="${href}" rel="noreferrer noopener">${label}</a>`,
  );
  out = out.replaceAll(
    /(?<!["'>=])(https?:\/\/[^\s<]+)/g,
    (href: string) => `<a href="${href}" rel="noreferrer noopener">${href}</a>`,
  );
  out = out.replaceAll(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replaceAll(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replaceAll(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  out = out.replaceAll(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');

  return out;
};

/** Same walk as `renderInline`, minus tags — the `text/plain` alternative. */
const renderInlineText = (input: string): string =>
  input
    .replaceAll(/`([^`]+)`/g, '$1')
    .replaceAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    .replaceAll(/\*\*([^*]+)\*\*/g, '$1')
    .replaceAll(/__([^_]+)__/g, '$1')
    .replaceAll(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1$2')
    .replaceAll(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1$2');

interface Block {
  kind: 'code' | 'heading' | 'hr' | 'list' | 'paragraph' | 'quote';
  level?: number;
  lines: string[];
  ordered?: boolean;
}

const BLOCK_START = /^(?:#{1,6}\s|```|---|\*\*\*|>\s?|\s*(?:[-*+]|\d+[.)])\s)/;

/** Split into block tokens; consecutive non-block lines merge into one paragraph. */
const tokenize = (markdown: string): Block[] => {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    if (line.trimStart().startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trimStart().startsWith('```')) {
        code.push(lines[index]!);
        index += 1;
      }
      index += 1; // closing fence
      blocks.push({ kind: 'code', lines: code });
      continue;
    }

    if (/(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      blocks.push({ kind: 'hr', lines: [] });
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})(.*)$/.exec(line);
    const headingRest = heading?.[2] ?? '';
    if (
      heading &&
      (headingRest === '' || headingRest.startsWith(' ') || headingRest.startsWith('\t'))
    ) {
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length,
        lines: [headingRest.trim()],
      });
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index]!)) {
        quote.push(lines[index]!.replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ kind: 'quote', lines: quote });
      continue;
    }

    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (index < lines.length && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[index]!)) {
        items.push(lines[index]!.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''));
        index += 1;
      }
      blocks.push({ kind: 'list', lines: items, ordered });
      continue;
    }

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() !== '' &&
      !BLOCK_START.test(lines[index]!)
    ) {
      paragraph.push(lines[index]!);
      index += 1;
    }
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }

  return blocks;
};

/** Ordered vs unordered comes from the `ordered` flag recorded while tokenizing. */
export const markdownToHtml = (markdown: string): string => {
  const blocks = tokenize(markdown);
  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.kind) {
      case 'code': {
        parts.push(`<pre><code>${escapeHtml(block.lines.join('\n'))}</code></pre>`);
        break;
      }
      case 'heading': {
        const level = block.level ?? 1;
        parts.push(`<h${level}>${renderInline(block.lines[0] ?? '')}</h${level}>`);
        break;
      }
      case 'hr': {
        parts.push('<hr />');
        break;
      }
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        const items = block.lines.map((item) => `<li>${renderInline(item)}</li>`).join('');
        parts.push(`<${tag}>${items}</${tag}>`);
        break;
      }
      case 'quote': {
        parts.push(`<blockquote>${renderInline(block.lines.join('\n'))}</blockquote>`);
        break;
      }
      default: {
        parts.push(`<p>${renderInline(block.lines.join('\n'))}</p>`);
      }
    }
  }

  return parts.join('\n');
};

export const markdownToPlainText = (markdown: string): string => {
  const blocks = tokenize(markdown);
  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.kind) {
      case 'code': {
        parts.push(block.lines.join('\n'));
        break;
      }
      case 'heading': {
        parts.push(renderInlineText(block.lines[0] ?? ''));
        break;
      }
      case 'hr': {
        parts.push('---');
        break;
      }
      case 'list': {
        parts.push(block.lines.map((item) => `- ${renderInlineText(item)}`).join('\n'));
        break;
      }
      case 'quote': {
        parts.push(block.lines.map((line) => `> ${renderInlineText(line)}`).join('\n'));
        break;
      }
      default: {
        parts.push(renderInlineText(block.lines.join('\n')));
      }
    }
  }

  return parts.join('\n\n').trim();
};

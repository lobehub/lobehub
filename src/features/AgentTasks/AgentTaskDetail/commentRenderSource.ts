import { writeTopicCommentMentionMarkdown } from '@/features/Portal/TopicComments/editorUtils';

interface CommentSource {
  content?: string | null;
  editorData?: unknown;
}

interface SnapshotMention {
  label: string;
  metadata: Record<string, unknown>;
  /** How many `@label` spellings precede this mention in the snapshot text. */
  occurrence: number;
}

type LexicalNode = Record<string, unknown>;

const asNode = (value: unknown): LexicalNode | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as LexicalNode) : undefined;

const childrenOf = (node: LexicalNode): unknown[] =>
  Array.isArray(node.children) ? node.children : [];

// The editor turns these into lists, headings, quotes, code, emphasis and links
// as they are typed, so plain text only holds them when the snapshot was built
// by hand from markdown source (API / CLI / agent callers).
const MARKDOWN_BLOCK_SOURCE =
  /^\s{0,3}(?:[*+-]\s|\d+[.)]\s|#{1,6}\s|>(?:\s|$)|```|~~~)|^\s*\|.*\|\s*$/;
const MARKDOWN_INLINE_SOURCE =
  /`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|(?:^|[^\w*])\*[^\s*][^*\n]*\*(?![\w*])|(?:^|\W)_[^\s_][^_\n]*_\b|\[[^\]\n]+\]\([^)\s]+\)/;

const isMarkdownSourceLine = (line: string) =>
  MARKDOWN_BLOCK_SOURCE.test(line) || MARKDOWN_INLINE_SOURCE.test(line);

const countOccurrences = (text: string, needle: string) => text.split(needle).length - 1;

// Escaped characters are literal text, never markdown syntax.
const stripEscapes = (markdown: string) => markdown.replaceAll(/\\[\s\S]/g, '');

const MENTION_TAG_NAME = /<mention\s(?:[^>]*\s)?name\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*\/>/gi;

/** The visible text of a markdown body, whitespace and escapes ignored. */
const toComparableText = (markdown: string) =>
  markdown
    .replaceAll(
      MENTION_TAG_NAME,
      (_, doubleQuoted, singleQuoted) => `@${doubleQuoted ?? singleQuoted}`,
    )
    .replaceAll(/\\([\s\S])/g, '$1')
    .replaceAll(/\s+/g, '');

/**
 * Whether the markdown body carries formatting the snapshot lost. Hand-built
 * snapshots may keep the source markers (`- `, backticks) or drop them (bold
 * reduced to plain text), so check both. An editor snapshot's body is its own
 * serialization: the same visible text, with any literal markers escaped.
 */
const hasMarkdownBeyondSnapshot = (content: string, lines: string[]) => {
  if (lines.some(isMarkdownSourceLine)) return true;
  if (toComparableText(content) === toComparableText(lines.join('\n'))) return false;

  return stripEscapes(content).split('\n').some(isMarkdownSourceLine);
};

/**
 * Read a snapshot made only of unformatted paragraphs. Returns its text lines
 * and mentions, or `undefined` once any node carries rich structure the
 * markdown body could not reproduce (lists, files, images, styled text…).
 */
const readPlainSnapshot = (
  editorData: unknown,
): { lines: string[]; mentions: SnapshotMention[] } | undefined => {
  const root = asNode(asNode(editorData)?.root);
  if (!root) return;

  const lines: string[] = [];
  const mentions: SnapshotMention[] = [];
  let previousText = '';

  for (const block of childrenOf(root)) {
    const paragraph = asNode(block);
    if (paragraph?.type !== 'paragraph') return;

    let line = '';
    for (const child of childrenOf(paragraph)) {
      const node = asNode(child);
      if (!node) return;

      if (node.type === 'text') {
        if (node.format || node.style || typeof node.text !== 'string') return;
        line += node.text;
      } else if (node.type === 'linebreak') {
        lines.push(line);
        previousText += `${line}\n`;
        line = '';
      } else if (node.type === 'mention') {
        const metadata = asNode(node.metadata);
        const label = typeof node.label === 'string' ? node.label : '';
        if (metadata && label) {
          const occurrence = countOccurrences(`${previousText}${line}`, `@${label}`);
          mentions.push({ label, metadata, occurrence });
        }
        line += `@${label}`;
      } else {
        return;
      }
    }
    lines.push(line);
    previousText += `${line}\n`;
  }

  return { lines, mentions };
};

/**
 * Callers without the rich editor sometimes send a hand-built Lexical snapshot
 * (one plain paragraph per markdown line, just to carry member mentions) next
 * to the real markdown `content`. Rendering that snapshot shows raw `- ` and
 * backticks, or loses formatting the builder stripped, so render the markdown
 * body instead.
 *
 * Returns the markdown to render, or `undefined` when the snapshot is the
 * faithful source and should be rendered as is. Snapshot mentions that the
 * body only spells as `@Name` are restored as mention tags.
 */
export const resolveMarkdownSnapshotContent = ({
  content,
  editorData,
}: CommentSource): string | undefined => {
  if (!content?.trim()) return;

  const snapshot = readPlainSnapshot(editorData);
  if (!snapshot || !hasMarkdownBeyondSnapshot(content, snapshot.lines)) return;

  // A body that already serializes its mentions is rendered as written.
  if (content.includes('<mention')) return content;

  // Restore each mention at the same `@label` occurrence the snapshot puts it,
  // so a literal `@Name` (for example in inline code) is left alone.
  const replacements = snapshot.mentions.flatMap((mention) => {
    const needle = `@${mention.label}`;
    let index = -1;
    for (let seen = 0; seen <= mention.occurrence; seen++) {
      index = content.indexOf(needle, index + 1);
      if (index < 0) return [];
    }
    return [
      { end: index + needle.length, start: index, tag: writeTopicCommentMentionMarkdown(mention) },
    ];
  });

  let markdown = content;
  for (const { end, start, tag } of replacements.sort((a, b) => b.start - a.start)) {
    markdown = markdown.slice(0, start) + tag + markdown.slice(end);
  }

  return markdown;
};

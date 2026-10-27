import { writeTopicCommentMentionMarkdown } from '@/features/Portal/TopicComments/editorUtils';

interface CommentSource {
  content?: string | null;
  editorData?: unknown;
}

interface SnapshotMention {
  label: string;
  metadata: Record<string, unknown>;
}

type LexicalNode = Record<string, unknown>;

const asNode = (value: unknown): LexicalNode | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as LexicalNode) : undefined;

const childrenOf = (node: LexicalNode): unknown[] =>
  Array.isArray(node.children) ? node.children : [];

// The editor turns these into lists, headings, quotes, code and links as they
// are typed, so a plain text node only holds them when the snapshot was built
// by hand from markdown source (API / CLI / agent callers).
const MARKDOWN_BLOCK_SOURCE = /^\s{0,3}(?:[*+-]\s|\d+[.)]\s|#{1,6}\s|>(?:\s|$)|```|~~~)/;
const MARKDOWN_INLINE_SOURCE = /`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)/;

const isMarkdownSourceLine = (line: string) =>
  MARKDOWN_BLOCK_SOURCE.test(line) || MARKDOWN_INLINE_SOURCE.test(line);

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
        line = '';
      } else if (node.type === 'mention') {
        const metadata = asNode(node.metadata);
        const label = typeof node.label === 'string' ? node.label : '';
        if (metadata && label) mentions.push({ label, metadata });
        line += `@${label}`;
      } else {
        return;
      }
    }
    lines.push(line);
  }

  return { lines, mentions };
};

/**
 * Callers without the rich editor sometimes send a hand-built Lexical snapshot
 * (one plain paragraph per markdown line, just to carry member mentions) next
 * to the real markdown `content`. Rendering that snapshot shows raw `- `, `**`
 * and backticks, so render the markdown body instead.
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
  if (!snapshot || !snapshot.lines.some(isMarkdownSourceLine)) return;

  // A body that already serializes its mentions is rendered as written.
  if (content.includes('<mention')) return content;

  // Walk the body in snapshot order so a member mentioned twice keeps both.
  let markdown = '';
  let rest = content;
  for (const mention of snapshot.mentions) {
    const index = rest.indexOf(`@${mention.label}`);
    if (index < 0) continue;

    markdown += rest.slice(0, index) + writeTopicCommentMentionMarkdown(mention);
    rest = rest.slice(index + mention.label.length + 1);
  }

  return markdown + rest;
};

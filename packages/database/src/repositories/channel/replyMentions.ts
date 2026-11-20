import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

/**
 * Agent replies that @mention another Agent wake it, so two Agents can hand work to each other
 * in the open. Each wake carries the number of Agent-to-Agent hops since the last person spoke
 * (`metadata.mentionHops` on the waking reply); past this many, mentions are still recorded and
 * shown, but wake no one. A person's message starts the count again.
 */
export const MAX_REPLY_MENTION_HOPS = 3;

export interface MentionableMember {
  id: string;
  name: string;
}

const escapeRegExp = (value: string) => value.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');

const markdown = unified().use(remarkParse).use(remarkGfm);

/** A bare or `<…>` link shows its own address as its text; that address addresses no one. */
const isAutolinkText = (value: string, parent: { type: string; url?: string } | undefined) =>
  parent?.type === 'link' &&
  !!parent.url &&
  [value, `http://${value}`, `mailto:${value}`].includes(parent.url);

/**
 * The text a reader sees, one entry per Markdown text node — the nodes the timeline's
 * `remarkChannelMentions` highlights. Code, link and image destinations and HTML are not text
 * nodes, and an autolink's text is its address, so an `@Name` there is never addressed.
 */
const renderedText = (content: string) => {
  const parts: string[] = [];
  visit(markdown.parse(content), 'text', (node: { value: string }, _index, parent: any) => {
    if (!isAutolinkText(node.value, parent)) parts.push(node.value);
  });
  return parts;
};

/**
 * Members an Agent's reply addresses as plain `@Name` text, matched the way the timeline
 * highlights mentions: a longer name wins over a shorter prefix, and a name must end at a space,
 * punctuation or the end (`@Pi` never matches inside `@Pilot`). A name two members share is
 * ambiguous and matches neither. Returns member ids in order of first appearance.
 */
export const findTextMentions = (content: string, members: MentionableMember[]): string[] => {
  const byName = new Map<string, string | null>();
  for (const { id, name } of members) {
    const key = name.trim();
    if (!key) continue;
    byName.set(key, byName.has(key) && byName.get(key) !== id ? null : id);
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  if (!names.length) return [];

  const pattern = new RegExp(
    `@(${names.map(escapeRegExp).join('|')})(?=$|[\\s\\p{P}\\p{S}])`,
    'gu',
  );
  const found: string[] = [];
  for (const text of renderedText(content))
    for (const match of text.matchAll(pattern)) {
      const id = byName.get(match[1]);
      if (id && !found.includes(id)) found.push(id);
    }
  return found;
};

/** Hops recorded on a reply that woke Agents; 0 for anything else. */
export const replyMentionHops = (metadata: Record<string, unknown> | null | undefined) => {
  const hops = metadata?.mentionHops;
  return typeof hops === 'number' && Number.isSafeInteger(hops) && hops > 0 ? hops : 0;
};

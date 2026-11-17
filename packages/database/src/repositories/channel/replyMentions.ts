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

/** Fenced blocks, then inline code: an `@Name` there is quoted, not addressed. */
const stripCode = (content: string) =>
  content.replaceAll(/(`{3,}|~{3,})[\S\s]*?(?:\1|$)/g, ' ').replaceAll(/`[^\n`]+`/g, ' ');

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
  for (const match of stripCode(content).matchAll(pattern)) {
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

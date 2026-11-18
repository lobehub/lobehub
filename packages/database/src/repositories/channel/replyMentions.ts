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

/** A fence opens with three or more backticks or tildes, indented at most three spaces. */
const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
/** The closing fence carries the same character, at least as long, and nothing else. */
const FENCE_CLOSE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/;
/** An indented code line starts with four spaces or a tab. */
const CODE_INDENT = /^(?: {4,}|\t)/;

const stripFencesAndIndentedCode = (content: string) => {
  const kept: string[] = [];
  let fence: string | null = null;
  let inIndented = false;
  let afterBlank = true;

  for (const line of content.split('\n')) {
    if (fence) {
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      kept.push('');
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    if (open) {
      fence = open[1];
      inIndented = false;
      kept.push('');
      continue;
    }

    if (CODE_INDENT.test(line) && (inIndented || afterBlank)) {
      // An indented code block cannot interrupt a paragraph, so only a block that starts after a
      // blank line counts; later indented or blank lines belong to it.
      inIndented = true;
      kept.push('');
      continue;
    }

    if (inIndented && line.trim() === '') {
      kept.push('');
      continue;
    }

    inIndented = false;
    afterBlank = line.trim() === '';
    kept.push(line);
  }

  return kept.join('\n');
};

/** Index of the next run of exactly `length` backticks at or after `from`; -1 when there is none. */
const findClosingRun = (content: string, from: number, length: number) => {
  for (let i = from; i < content.length;) {
    if (content[i] !== '`') {
      i += 1;
      continue;
    }
    let run = 1;
    while (content[i + run] === '`') run += 1;
    if (run === length) return i;
    i += run;
  }
  return -1;
};

/**
 * Code spans open with any number of backticks and close on a run of the same length, holding
 * anything in between — a backtick, a newline. An unmatched run stays literal, as it renders.
 */
const stripCodeSpans = (content: string) => {
  let text = '';
  let i = 0;
  while (i < content.length) {
    if (content[i] !== '`') {
      text += content[i];
      i += 1;
      continue;
    }
    let run = 1;
    while (content[i + run] === '`') run += 1;
    const close = findClosingRun(content, i + run, run);
    if (close === -1) {
      text += '`'.repeat(run);
      i += run;
      continue;
    }
    text += ' ';
    i = close + run;
  }
  return text;
};

/** Quoted code, as the timeline renders it: fenced blocks, indented blocks and code spans. */
const stripCode = (content: string) => stripCodeSpans(stripFencesAndIndentedCode(content));

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

/** Folder the retro documents live in, so they do not crowd the agent's top-level documents. */
export const BOT_REFLECTION_FOLDER = 'Bot Reflection';

/**
 * Agent document holding the lessons a bot agent keeps in front of itself. Loaded into every run
 * of the agent; the owner may edit or disable it, and the next retro starts from whatever is there.
 */
export const BOT_LESSONS_FILENAME = 'bot-lessons.md';

/** Agent document holding the dated retro entries, newest first. Not loaded into runs. */
export const BOT_RETRO_LOG_FILENAME = 'bot-retro-log.md';

/** Oldest entries past this count are dropped from the retro log. */
export const BOT_RETRO_LOG_MAX_ENTRIES = 30;

const LESSONS_HEADER = [
  '# Bot lessons',
  '',
  'Habits I keep after reviewing my chat-platform conversations each night. Edit freely; the next nightly retro starts from this list.',
  '',
].join('\n');

const LOG_HEADER = [
  '# Bot retro log',
  '',
  'What I reviewed each night: platform problems (and whether I vented them) and my own mistakes.',
  '',
].join('\n');

const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s+(.+?)\s*$/;
const ENTRY_HEADING = /^## \d{4}-\d{2}-\d{2}\s*$/m;

export interface BotRetroPlatformIssue {
  detail: string;
  title: string;
  /** Whether a vent the agent filed covers this issue. */
  vented: boolean;
}

export interface BotRetroSelfMistake {
  lesson: string;
  what: string;
}

export interface BotRetroLogEntryInput {
  date: string;
  platformIssues: BotRetroPlatformIssue[];
  selfMistakes: BotRetroSelfMistake[];
  summary: string;
}

/**
 * Reads the lessons back from the lessons document: every list item, in order.
 *
 * Before:
 * - "# Bot lessons\n\n...\n\n- Confirm the thread before replying\n- Never retry …"
 *
 * After:
 * - ["Confirm the thread before replying", "Never retry …"]
 */
export const parseBotLessons = (content: string | null | undefined): string[] =>
  (content ?? '').split('\n').flatMap((line) => {
    const match = LIST_ITEM.exec(line);
    return match ? [match[1]] : [];
  });

/** Renders the full lessons document from the merged lesson list. */
export const renderBotLessons = (lessons: string[]): string =>
  `${LESSONS_HEADER}\n${lessons.map((lesson) => `- ${lesson}`).join('\n')}\n`;

/** Whether the retro log already holds an entry for `date`; a second run for that day is skipped. */
export const hasBotRetroLogEntry = (content: string | null | undefined, date: string): boolean =>
  new RegExp(`^## ${date}\\s*$`, 'm').test(content ?? '');

/** Renders one dated retro entry. Empty sections are left out. */
export const renderBotRetroLogEntry = (entry: BotRetroLogEntryInput): string => {
  const lines = [`## ${entry.date}`, '', entry.summary.trim()];

  if (entry.platformIssues.length > 0) {
    lines.push('', '### Platform issues', '');
    for (const issue of entry.platformIssues) {
      lines.push(
        `- ${issue.vented ? '[vented]' : '[not vented]'} **${issue.title.trim()}** — ${issue.detail.trim()}`,
      );
    }
  }

  if (entry.selfMistakes.length > 0) {
    lines.push('', '### My mistakes', '');
    for (const mistake of entry.selfMistakes) {
      lines.push(`- ${mistake.what.trim()} → next time: ${mistake.lesson.trim()}`);
    }
  }

  return lines.join('\n');
};

/**
 * Puts a new entry at the top of the retro log and drops entries past
 * {@link BOT_RETRO_LOG_MAX_ENTRIES}. Anything the owner wrote above the first entry is kept.
 */
export const prependBotRetroLogEntry = (
  content: string | null | undefined,
  entry: string,
  maxEntries = BOT_RETRO_LOG_MAX_ENTRIES,
): string => {
  const existing = content?.trim() ? content : LOG_HEADER;
  const firstEntry = existing.search(ENTRY_HEADING);
  const head = (firstEntry === -1 ? existing : existing.slice(0, firstEntry)).trimEnd();
  const body = firstEntry === -1 ? '' : existing.slice(firstEntry);

  const entries = body
    .split(/^(?=## \d{4}-\d{2}-\d{2}\s*$)/m)
    .map((part) => part.trim())
    .filter(Boolean);

  return `${[head, entry.trim(), ...entries].slice(0, maxEntries + 1).join('\n\n')}\n`;
};

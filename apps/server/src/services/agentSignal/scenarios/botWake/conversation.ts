import type { WakeConversationLine } from './types';

/** A message longer than this is cut: the log keeps context for a model, not an archive. */
export const CONVERSATION_LINE_MAX_CHARS = 500;

/** Messages a channel's log keeps; older ones are dropped as new ones arrive. */
export const CONVERSATION_LOG_MAX_LINES = 200;

/** Messages shown to the classifier. */
export const CONVERSATION_PROMPT_LINES = 20;

/** A name shorter than this would match inside ordinary words. */
const MIN_BOT_NAME_LENGTH = 2;

const DISCORD_EPOCH_MS = 1_420_070_400_000;

export interface ConversationLineInput {
  at: number;
  authorId?: string;
  authorName?: string;
  hasAttachments?: boolean;
  id: string;
  isBot: boolean;
  text?: string;
}

/** Normalizes a message into the short line kept in a channel's log. */
export const toConversationLine = (input: ConversationLineInput): WakeConversationLine => {
  const trimmed = (input.text ?? '').trim();
  const text =
    trimmed.length === 0
      ? input.hasAttachments
        ? '[attachment]'
        : ''
      : trimmed.length > CONVERSATION_LINE_MAX_CHARS
        ? `${trimmed.slice(0, CONVERSATION_LINE_MAX_CHARS)}…`
        : trimmed;

  return {
    at: input.at,
    authorId: input.authorId,
    authorName: input.authorName,
    id: input.id,
    isBot: input.isBot,
    text,
  };
};

/**
 * The stored form of a line. Key order is fixed, so two bots that see the same message write the
 * same string and the log keeps it once.
 */
export const serializeLine = (line: WakeConversationLine): string =>
  JSON.stringify({
    at: line.at,
    authorId: line.authorId,
    authorName: line.authorName,
    id: line.id,
    isBot: line.isBot,
    text: line.text,
  });

const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string';

/** Reads a stored line; anything that is not one is dropped instead of breaking a read. */
export const parseLine = (raw: string): WakeConversationLine | undefined => {
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;

    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.id !== 'string' ||
      typeof value.at !== 'number' ||
      typeof value.text !== 'string' ||
      typeof value.isBot !== 'boolean' ||
      !isOptionalString(value.authorId) ||
      !isOptionalString(value.authorName)
    ) {
      return undefined;
    }

    return value as unknown as WakeConversationLine;
  } catch {
    return undefined;
  }
};

/** A Discord message id is a snowflake: the time it was sent is in its high bits. */
export const discordMessageTime = (id: string): number | undefined => {
  if (!/^\d{15,20}$/.test(id)) return undefined;

  return Number(BigInt(id) >> 22n) + DISCORD_EPOCH_MS;
};

/**
 * One line as the classifier reads it: the bot is "Assistant", the bot's owner is marked, and
 * everyone else is named.
 */
export const describeLine = (
  line: WakeConversationLine,
  botAuthorId: string | undefined,
  ownerId?: string,
) => {
  const isOwner = ownerId !== undefined && line.authorId === ownerId;
  const name = line.authorName?.trim() || 'someone';
  const speaker =
    line.isBot && botAuthorId !== undefined && line.authorId === botAuthorId
      ? 'Assistant'
      : isOwner
        ? `${name} (owner)`
        : name;

  return `${speaker}: ${line.text}`;
};

const isWordChar = (char: string | undefined) => !!char && /\w/.test(char);

/**
 * Whether a message calls the bot by name.
 *
 * A name is plain text, never a pattern. Case-insensitive. A name that starts or ends with an
 * ASCII word character must not be glued to one (`Arvin` is not found in `arvinson`); other
 * scripts have no word boundary, so a Chinese name matches as a substring.
 */
export const matchesBotName = (text: string, names: readonly string[]): boolean => {
  if (!text) return false;
  const haystack = text.toLowerCase();

  return names.some((raw) => {
    const name = raw.trim().toLowerCase();
    if (name.length < MIN_BOT_NAME_LENGTH) return false;

    let from = 0;
    for (;;) {
      const at = haystack.indexOf(name, from);
      if (at === -1) return false;

      const before = haystack[at - 1];
      const after = haystack[at + name.length];
      const gluedBefore = isWordChar(name[0]) && isWordChar(before);
      const gluedAfter = isWordChar(name.at(-1)) && isWordChar(after);
      if (!gluedBefore && !gluedAfter) return true;

      from = at + 1;
    }
  });
};

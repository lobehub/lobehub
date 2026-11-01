export interface TranscriptMessage {
  content?: unknown;
  role?: string;
}

export interface TranscriptTurn {
  role: string;
  text: string;
}

export interface Transcript {
  context: TranscriptTurn[];
  /** Whether there is prior context to separate from the turn under test. */
  hasBoundary: boolean;
}

/**
 * Message content arrives as a string on most providers and as content parts on
 * others. Unusable parts are dropped rather than stringified, so a case with an
 * image attachment reads as its text instead of as `[object Object]`.
 */
export const toText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      const text = (part as { text?: unknown })?.text;
      return typeof text === 'string' ? text : '';
    })
    .filter(Boolean)
    .join('\n');
};

/**
 * The replayed conversation that precedes the turn under test.
 *
 * The system message is dropped: it is harness context rather than a turn
 * someone took, and showing it as one would misrepresent the conversation. The
 * boundary is only meaningful when something remains to be separated.
 */
export const buildTranscript = (messages?: TranscriptMessage[]): Transcript => {
  const context = (messages ?? [])
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role ?? 'user', text: toText(message.content) }));

  return { context, hasBoundary: context.length > 0 };
};

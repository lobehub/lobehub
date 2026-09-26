/**
 * One truncation contract for every place that shows the model part of a long text: attachment
 * previews, knowledge-file reads, agent-document reads, archived tool results, crawled pages and
 * local file reads.
 *
 * Borrowed from how Claude Code, Codex, opencode and pi handle long reads:
 * - cut on line boundaries, bounded by both a line count and a character budget;
 * - always tell the model the full size and the exact range it received;
 * - end with the exact call that reads the next window, so the model can load progressively
 *   instead of guessing or asking the user to paste the rest;
 * - say so explicitly when the stored text is itself shorter than the original, because paging can
 *   never reach content that was not stored.
 */

export interface TextWindowOptions {
  /** Maximum characters of `content`. Defaults to unbounded. */
  maxChars?: number;
  /** Maximum number of lines. Defaults to unbounded. */
  maxLines?: number | string;
  /** 1-based line to start from. Defaults to 1. */
  offset?: number | string;
}

/** Position of a window inside the full text. Shared by every notice and attribute formatter. */
export interface TextWindowRange {
  /**
   * Set when a line longer than the character budget was cut to fit. Line-based paging cannot
   * reach the rest of that line, so notices say so instead of promising more.
   */
  cutLine?: { keptChars: number; line: number; totalChars: number };
  /** 1-based, inclusive. `0` when the window is empty. */
  endLine: number;
  /** 1-based, inclusive. */
  startLine: number;
  /** Omitted by callers that only know the line count (e.g. a remote file read). */
  totalChars?: number;
  totalLines: number;
  /** True when content after the window exists: later lines, or the rest of a cut line. */
  truncated: boolean;
}

export interface TextWindow extends TextWindowRange {
  content: string;
  totalChars: number;
}

export interface TextWindowNoticeOptions {
  /**
   * Builds the instruction that reads from a given 1-based line, e.g.
   * `(line) => \`call readKnowledge again with offset=${line}\``. Omit it when the text cannot be
   * paged; the notice then only reports what was left out.
   */
  continueFrom?: (line: number) => string;
  /**
   * Character count of the original text when the stored text was cut before it was stored (for
   * example a parsed file above the parse-time cap). Ignored unless larger than `totalChars`.
   */
  originalChars?: number;
}

const toInteger = (value: number | string | undefined, fallback: number, min: number) => {
  // Some providers emit numeric arguments as strings (`"offset": "401"`); treating those as absent
  // would silently restart from line 1 and loop.
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (parsed === undefined || !Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
};

/**
 * Returns at most `maxChars` leading characters without splitting a UTF-16 surrogate pair.
 * A lone high surrogate serializes to a `\uD83D`-style escape that some providers (DeepSeek,
 * Anthropic) reject as "unexpected end of hex escape".
 */
export const sliceHead = (text: string, maxChars: number): string => {
  if (text.length <= maxChars) return text;

  let cutoff = Math.max(0, maxChars);
  const lastCharCode = text.charCodeAt(cutoff - 1);
  if (lastCharCode >= 0xd8_00 && lastCharCode <= 0xdb_ff) cutoff -= 1;

  return text.slice(0, cutoff);
};

export const countLines = (text: string): number => {
  let lines = 1;
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    lines += 1;
  }
  return lines;
};

/**
 * Cuts a window of whole lines out of `text`, starting at `offset`, bounded by `maxLines` and
 * `maxChars` (whichever is hit first).
 *
 * A line longer than `maxChars` can never be returned whole, so it is cut to the remaining budget
 * and reported as `cutLine`; the next window starts after it so paging cannot stall.
 */
export const sliceTextWindow = (text: string, options: TextWindowOptions = {}): TextWindow => {
  const lines = text.split('\n');
  const totalLines = lines.length;
  const totalChars = text.length;

  const maxLines = toInteger(options.maxLines, Number.MAX_SAFE_INTEGER, 1);
  const maxChars = toInteger(options.maxChars, Number.MAX_SAFE_INTEGER, 1);
  const startLine = toInteger(options.offset, 1, 1);

  if (startLine > totalLines) {
    return { content: '', endLine: 0, startLine, totalChars, totalLines, truncated: false };
  }

  const selected: string[] = [];
  let charCount = 0;
  let cutLine: TextWindow['cutLine'];

  for (let index = startLine - 1; index < totalLines && selected.length < maxLines; index++) {
    const line = lines[index];
    const separator = selected.length > 0 ? 1 : 0;
    const nextCount = charCount + separator + line.length;

    if (nextCount <= maxChars) {
      selected.push(line);
      charCount = nextCount;
      continue;
    }

    // Lines that fit a later window whole are left for it. Lines longer than the whole budget
    // never fit, so fill the remaining budget with their head instead of wasting it.
    const remaining = maxChars - charCount - separator;
    if (line.length > maxChars && remaining > 0) {
      const kept = sliceHead(line, remaining);
      selected.push(kept);
      cutLine = { keptChars: kept.length, line: index + 1, totalChars: line.length };
    }
    break;
  }

  const endLine = startLine + selected.length - 1;

  return {
    content: selected.join('\n'),
    cutLine,
    endLine,
    startLine,
    totalChars,
    totalLines,
    truncated: endLine < totalLines || cutLine !== undefined,
  };
};

const hasStoredCut = (range: TextWindowRange, originalChars?: number) =>
  originalChars !== undefined && range.totalChars !== undefined && originalChars > range.totalChars;

/**
 * XML attributes describing a window, shared by every `<file>` style tag the model sees:
 * ` lines="a-b" total_lines="N" total_chars="C" truncated="…"`, plus `original_chars` when the
 * stored text is shorter than the original.
 */
export const formatTextWindowAttributes = (
  range: TextWindowRange,
  { originalChars }: Pick<TextWindowNoticeOptions, 'originalChars'> = {},
): string => {
  const attributes = [
    `lines="${range.startLine}-${range.endLine}"`,
    `total_lines="${range.totalLines}"`,
  ];
  if (range.totalChars !== undefined) attributes.push(`total_chars="${range.totalChars}"`);
  attributes.push(`truncated="${range.truncated || hasStoredCut(range, originalChars)}"`);
  if (hasStoredCut(range, originalChars)) attributes.push(`original_chars="${originalChars}"`);

  return ` ${attributes.join(' ')}`;
};

/**
 * The model-facing notice for a window. Empty when the window is the complete text.
 *
 * Every notice states the range and total size, then the exact call for the next window.
 */
export const formatTextWindowNotice = (
  range: TextWindowRange,
  { continueFrom, originalChars }: TextWindowNoticeOptions = {},
): string => {
  const parts: string[] = [];
  const size =
    range.totalChars === undefined
      ? `${range.totalLines} lines`
      : `${range.totalLines} lines, ${range.totalChars} characters`;

  if (range.endLine === 0) {
    parts.push(
      `[Line ${range.startLine} is past the end of this text (${size}); nothing was returned. The text is not empty.]`,
    );
  } else if (range.cutLine) {
    const { keptChars, line, totalChars } = range.cutLine;
    const next =
      line < range.totalLines
        ? continueFrom
          ? ` To continue with the next line, ${continueFrom(line + 1)}.`
          : ` Lines ${line + 1}-${range.totalLines} were left out.`
        : '';
    parts.push(
      `[Showing lines ${range.startLine}-${line} of ${size}. Line ${line} is ${totalChars} characters long and was cut at ${keptChars}; the rest of that line cannot be paged.${next}]`,
    );
  } else if (range.truncated) {
    const next = continueFrom
      ? ` To continue, ${continueFrom(range.endLine + 1)}.`
      : ` Lines ${range.endLine + 1}-${range.totalLines} were left out.`;
    parts.push(`[Showing lines ${range.startLine}-${range.endLine} of ${size}.${next}]`);
  }

  if (hasStoredCut(range, originalChars)) {
    parts.push(
      `[The stored text is incomplete: only the first ${range.totalChars} of the original ${originalChars} characters were kept, ending at line ${range.totalLines}. Paging cannot go past that point. If the task needs the rest (for example aggregating a whole table), process the original file in a code sandbox or at its local path when available.]`,
    );
  }

  return parts.join('\n');
};

/** `content` followed by its notice on a new line, or `content` alone when nothing was left out. */
export const appendTextWindowNotice = (
  window: TextWindow,
  options: TextWindowNoticeOptions = {},
): string => {
  const notice = formatTextWindowNotice(window, options);
  return notice ? `${window.content}\n${notice}` : window.content;
};

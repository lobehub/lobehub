/**
 * Bounded, pageable window over a knowledge file for `readKnowledge`.
 *
 * A single knowledge-base file routinely runs to 30–40k characters. Returning
 * it whole made one `readKnowledge` call the largest item in the model context
 * and pushed every such result past the tool-result archive threshold, which
 * then persisted a byte-identical copy per topic. The tool now returns one
 * window per call and tells the model how to continue.
 */

/** Default number of lines returned per file when the model passes no `limit`. */
export const DEFAULT_READ_KNOWLEDGE_LINE_LIMIT = 400;

/** Upper bound on `limit`, so a model cannot opt back into whole-file reads. */
export const MAX_READ_KNOWLEDGE_LINE_LIMIT = 2000;

/**
 * Hard cap on characters returned per file per call, applied on top of the
 * line limit. Two files at this cap stay under the 25k tool-result archive
 * threshold, so an ordinary two-file read no longer archives anything.
 */
export const MAX_READ_KNOWLEDGE_CHARS_PER_FILE = 10_000;

export interface ReadWindowOptions {
  /** Maximum number of lines to return; defaults to {@link DEFAULT_READ_KNOWLEDGE_LINE_LIMIT}. */
  limit?: number | string;
  /** Maximum characters to return; defaults to {@link MAX_READ_KNOWLEDGE_CHARS_PER_FILE}. */
  maxChars?: number;
  /** 1-based line number to start from; defaults to 1. */
  offset?: number | string;
}

export interface ReadWindow {
  content: string;
  /** 1-based, inclusive. `0` when the window is empty. */
  endLine: number;
  /** 1-based, inclusive. */
  startLine: number;
  totalCharCount: number;
  totalLineCount: number;
  /** True when lines after `endLine` were left out and the model should page. */
  truncated: boolean;
}

const clampInteger = (
  value: number | string | undefined,
  fallback: number,
  min: number,
  max: number,
) => {
  // Some providers emit numeric arguments as strings (`"offset": "401"`);
  // treating those as absent would silently restart from line 1 and loop.
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (parsed === undefined || !Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

export const sliceReadWindow = (content: string, options: ReadWindowOptions = {}): ReadWindow => {
  const lines = content.split('\n');
  const totalLineCount = lines.length;
  const totalCharCount = content.length;

  const limit = clampInteger(
    options.limit,
    DEFAULT_READ_KNOWLEDGE_LINE_LIMIT,
    1,
    MAX_READ_KNOWLEDGE_LINE_LIMIT,
  );
  const maxChars = clampInteger(
    options.maxChars,
    MAX_READ_KNOWLEDGE_CHARS_PER_FILE,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const startLine = clampInteger(options.offset, 1, 1, Number.MAX_SAFE_INTEGER);

  if (startLine > totalLineCount) {
    return {
      content: '',
      endLine: 0,
      startLine,
      totalCharCount,
      totalLineCount,
      truncated: false,
    };
  }

  const selected: string[] = [];
  let charCount = 0;

  for (let index = startLine - 1; index < totalLineCount && selected.length < limit; index++) {
    const line = lines[index];
    // Always include at least one line so a single oversized line cannot stall
    // paging forever; otherwise stop before the char cap is exceeded.
    const nextCount = charCount + line.length + (selected.length > 0 ? 1 : 0);
    if (selected.length > 0 && nextCount > maxChars) break;

    selected.push(line);
    charCount = nextCount;
  }

  const endLine = startLine + selected.length - 1;

  return {
    content: selected.join('\n'),
    endLine,
    startLine,
    totalCharCount,
    totalLineCount,
    truncated: endLine < totalLineCount,
  };
};

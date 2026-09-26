import { sliceTextWindow, type TextWindow } from '@lobechat/prompts/textWindow';

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

const resolveLimit = (limit: number | string | undefined) => {
  const parsed = typeof limit === 'string' ? Number(limit) : limit;
  if (parsed === undefined || !Number.isFinite(parsed)) return DEFAULT_READ_KNOWLEDGE_LINE_LIMIT;
  return Math.min(MAX_READ_KNOWLEDGE_LINE_LIMIT, Math.max(1, Math.floor(parsed)));
};

/** The shared line window, with readKnowledge's line and character bounds applied. */
export const sliceReadWindow = (content: string, options: ReadWindowOptions = {}): TextWindow =>
  sliceTextWindow(content, {
    maxChars: options.maxChars ?? MAX_READ_KNOWLEDGE_CHARS_PER_FILE,
    maxLines: resolveLimit(options.limit),
    offset: options.offset,
  });

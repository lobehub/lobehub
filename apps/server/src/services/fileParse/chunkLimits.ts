// Pure module bundled into the parse worker: no document service, DB or environment.
import { MAX_FILE_PARSE_SIZE } from '@/const/file';
import type { DocumentChunk } from '@/libs/document-loaders/types';

/**
 * Bounds of what one chunk job may copy back to the request thread. The worker only measures the
 * result, it never truncates: a file that exceeds a bound fails, so the caller cannot index half a
 * document and call it complete.
 *
 * The text bound is sized from the input cap: the splitter overlaps neighbouring chunks (800
 * characters every 400), so a file at `MAX_FILE_PARSE_SIZE` yields about twice its size, and a
 * spreadsheet repeats the header on every row, hence the factor 3. The count bound is a quarter of
 * a million rows more than a full-size text file needs.
 */
export interface ChunkResultLimits {
  maxChars: number;
  maxChunks: number;
}

export const DEFAULT_CHUNK_RESULT_LIMITS: ChunkResultLimits = {
  maxChars: 3 * MAX_FILE_PARSE_SIZE,
  maxChunks: 500_000,
};

export class ChunkOutputTooLargeError extends Error {
  readonly actual: number;
  readonly limit: number;
  readonly unit: 'chars' | 'chunks';

  constructor(unit: 'chars' | 'chunks', limit: number, actual: number) {
    super(`File produced too many chunk ${unit} to index: ${actual} > ${limit}`);
    this.name = 'FileParseOutputTooLargeError';
    this.unit = unit;
    this.limit = limit;
    this.actual = actual;
  }
}

/** Returns the chunks untouched, or throws; a result over the bound is never cut down. */
export const assertChunkResultWithinLimits = (
  chunks: DocumentChunk[],
  limits: ChunkResultLimits = DEFAULT_CHUNK_RESULT_LIMITS,
): DocumentChunk[] => {
  if (chunks.length > limits.maxChunks) {
    throw new ChunkOutputTooLargeError('chunks', limits.maxChunks, chunks.length);
  }

  let chars = 0;
  for (const chunk of chunks) {
    chars += chunk.pageContent.length;
    if (chars > limits.maxChars) {
      throw new ChunkOutputTooLargeError('chars', limits.maxChars, chars);
    }
  }
  return chunks;
};

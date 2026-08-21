import { estimateTokenCount, splitByTokens } from 'tokenx';

export interface ChunkByTokensOptions {
  /**
   * Overlap (in tokens) between adjacent chunks. Clamped below the target chunk size.
   *
   * @default 0
   */
  overlap?: number;
  /**
   * Maximum number of tokens per chunk.
   */
  tokenLimit: number;
}

// Matches sentence/line boundaries; used to re-anchor a hard token split so
// chunks break on readable boundaries instead of mid-sentence.
const BOUNDARY_REGEXP = /(?<=[。！？!?；;.…%~\n])\s*/gu;

/**
 * Splits a long text into chunks sized under `tokenLimit`, preferring to break
 * on sentence/paragraph boundaries so each chunk keeps readable semantics.
 *
 * Under the hood it uses `tokenx.splitByTokens` for fast token-count-aware
 * splitting, then re-anchors each hard cut to the last sentence boundary
 * inside the chunk when one exists — so chunks rarely end mid-sentence.
 *
 * Use for embedding long inputs (e.g. conversations) whose complete text
 * exceeds a provider's per-input token window: instead of hard-trimming the
 * tail (which drops the head of the text), embed each chunk and combine the
 * resulting vectors downstream.
 *
 * @example
 * const chunks = await chunkByTokens(longText, { tokenLimit: 2000, overlap: 100 });
 */
export const chunkByTokens = async (
  text: string,
  options: ChunkByTokensOptions,
): Promise<string[]> => {
  const { tokenLimit, overlap = 0 } = options;

  const normalized = text.trim();
  if (!normalized) return [];
  if (tokenLimit <= 0 || estimateTokenCount(normalized) <= tokenLimit) {
    return [normalized];
  }

  const hardChunks = splitByTokens(normalized, tokenLimit, { overlap });
  if (hardChunks.length <= 1) return hardChunks.map((chunk) => chunk.trim()).filter(Boolean);

  const aligned: string[] = [];
  let carry = '';

  for (const chunk of hardChunks) {
    // Prepend any text carried over from the previous chunk's tail alignment.
    const combined = carry ? carry + '\n' + chunk : chunk;
    carry = '';

    if (combined.length > 0) {
      const boundaryMatch = findLastBoundary(combined);
      if (boundaryMatch !== -1) {
        const head = combined.slice(0, boundaryMatch);
        const tail = combined.slice(boundaryMatch);
        if (head.trim().length > 0 && tail.trim().length > 0) {
          aligned.push(head.trim());
          carry = tail.trim();
          continue;
        }
      }
    }

    aligned.push(combined.trim());
  }

  if (carry) {
    // Fold the last carry into the final chunk when it fits, otherwise keep it.
    const last = aligned.at(-1);
    if (last && estimateTokenCount(last + '\n' + carry) <= tokenLimit) {
      aligned[aligned.length - 1] = (last + '\n' + carry).trim();
    } else {
      aligned.push(carry);
    }
  }

  return aligned.filter(Boolean);
};

const findLastBoundary = (text: string): number => {
  const matches = [...text.matchAll(BOUNDARY_REGEXP)];
  if (matches.length === 0) return -1;

  // Prefer the latest boundary that still leaves a meaningful head chunk
  // (at least 30% of the chunk), so the alignment does not starve the head.
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const boundary = matches[i]!.index! + matches[i]![0].length;
    if (boundary <= text.length * 0.3) break;
    return boundary;
  }

  return -1;
};

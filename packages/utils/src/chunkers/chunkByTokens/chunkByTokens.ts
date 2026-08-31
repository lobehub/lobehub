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

  const pushAligned = (piece: string) => {
    const trimmed = piece.trim();
    if (!trimmed) return;

    // Re-check the token count after sentence-boundary alignment: `head` can
    // combine a carried tail with most of the next hard chunk and exceed the
    // limit (up to ~1.7×). Re-split oversized pieces token-wise so every
    // emitted chunk is bounded and safe for embedding providers.
    if (estimateTokenCount(trimmed) > tokenLimit) {
      aligned.push(...splitWithinLimit(trimmed, tokenLimit));
      return;
    }

    aligned.push(trimmed);
  };

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
          pushAligned(head);
          carry = tail.trim();
          continue;
        }
      }
    }

    pushAligned(combined);
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

  // Final boundedness pass. tokenx.splitByTokens estimates loosely and can
  // emit chunks above `tokenLimit` for CJK text without spaces (measured up
  // to ~1.2x); the in-loop guard re-splits but inherits the same bias. Iterate
  // the re-split here so every emitted chunk is strictly under the limit,
  // which embedding providers enforce per-input.
  const bounded = aligned.flatMap((chunk) => splitWithinLimit(chunk, tokenLimit));

  return bounded.filter(Boolean);
};

const splitWithinLimit = (text: string, tokenLimit: number, attempts = 8): string[] => {
  const trimmed = text.trim();
  if (!trimmed || estimateTokenCount(trimmed) <= tokenLimit) return [text];
  // Pathological one-char input; nothing left to split.
  if (trimmed.length <= 1) return [text];

  let pieces: string[] = [];
  if (attempts > 0) {
    pieces = splitByTokens(trimmed, tokenLimit)
      .map((piece) => piece.trim())
      .filter(Boolean);
  }

  // tokenx returned the input unchanged (no-space CJK text) or we ran out of
  // attempts: binary-split the text, preferring a sentence boundary.
  if (pieces.length <= 1) {
    const cut = preferredCut(trimmed);
    return [
      ...splitWithinLimit(trimmed.slice(0, cut), tokenLimit, attempts - 1),
      ...splitWithinLimit(trimmed.slice(cut), tokenLimit, attempts - 1),
    ];
  }

  // Re-anchor pieces to sentence boundaries across piece boundaries: any
  // dangling sentence tail is carried into the next piece so emitted chunks
  // never end mid-sentence (tokenx itself splits blindly at token counts).
  const parts: string[] = [];
  let pending = '';
  for (const raw of pieces) {
    const piece = pending ? `${pending}${raw}` : raw;
    pending = '';
    const boundary = findLastBoundary(piece);
    const tail = boundary === -1 ? '' : piece.slice(boundary);
    if (boundary === -1 || boundary >= piece.length || tail.trim().length === 0) {
      if (piece) parts.push(piece);
    } else {
      const headPiece = piece.slice(0, boundary);
      if (headPiece.trim()) parts.push(headPiece.trim());
      pending = tail.trim();
    }
  }
  if (pending) parts.push(pending);

  // Recurse into pieces that are still over the limit; sub-limit pieces were
  // already re-anchored and are kept as-is.
  return parts.flatMap((part) => splitWithinLimit(part, tokenLimit, attempts - 1));
};

// Chooses a binary-split point for text that tokenx could not handle: the
// last sentence boundary when one exists, otherwise the last whitespace,
// otherwise the character midpoint. Always strictly inside the text.
const preferredCut = (text: string): number => {
  const boundary = findLastBoundary(text);
  if (boundary !== -1 && boundary > 0 && boundary < text.length) return boundary;

  let cut = -1;
  const wsMatches = [...text.matchAll(/\s/g)];
  if (wsMatches.length > 0) cut = wsMatches.at(-1)!.index! + 1;
  if (cut > 0 && cut < text.length) return cut;

  return Math.ceil(Math.max(1, text.length) / 2);
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

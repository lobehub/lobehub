import type { ToolProjector } from '../types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Build a projector for a search whose card lists its hits and whose chip
 * counts them.
 *
 * Two tools share this shape exactly — `lobe-web-browsing/search` with
 * `results`, `lobe-knowledge-base/searchKnowledgeBase` with `fileResults` — and
 * in both the hit list IS the state. Nothing smaller can be kept for the card,
 * because the card renders all of it; what makes them projectable is WHEN. The
 * card mounts with the row's expansion, while the collapsed chip needs one
 * number: how many hits came back, and whether any did.
 *
 * So the hits go and their count is pinned as `resultCount`. The chip reads
 * that, falling back to the array for payloads stored before this existed.
 * `resultCount` is pinned rather than recomputed because the array it came from
 * is exactly what got dropped — and it must survive an empty result, which is
 * why the chip distinguishes "0 hits" from "not settled yet".
 */
const createSearchResultProjector = (
  listKeys: string[],
  countHits?: (pluginState: Record<string, unknown>) => number,
): ToolProjector => {
  const dropped = new Set(listKeys);

  return ({ pluginState }) => {
    if (!isRecord(pluginState)) return { content: null, storedPayloadNeededBy: 'render' };

    const hits = listKeys.map((k) => pluginState[k]).find(Array.isArray);
    const rest = Object.fromEntries(
      Object.entries(pluginState).filter(([key]) => !dropped.has(key)),
    );

    return {
      content: null,
      pluginState: {
        ...rest,
        ...(hits && { resultCount: countHits?.(pluginState) ?? hits.length }),
      },
      storedPayloadNeededBy: 'render',
    };
  };
};

/** `lobe-web-browsing/search` — `{ costTime, query, resultNumbers, results }`. */
export const webSearchProjector = createSearchResultProjector(['results']);

const asRecords = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : []);

/** Files from the vector path, plus full-text hits no listed file already covers. */
const countKnowledgeBaseHits = (pluginState: Record<string, unknown>) => {
  const files = asRecords(pluginState.fileResults);
  const fileIds = new Set(files.map(({ fileId }) => fileId));
  const documentOnlyHits = asRecords(pluginState.documents).filter(
    ({ fileId }) => !fileId || !fileIds.has(fileId),
  );

  return files.length + documentOnlyHits.length;
};

/**
 * `lobe-knowledge-base/searchKnowledgeBase`. Three parallel hit lists, all
 * card-only. `fileResults` and `documents` come from independent retrieval
 * paths, so the chip counts both; `chunks` is `fileResults` in another shape.
 */
export const searchKnowledgeBaseProjector = createSearchResultProjector(
  ['fileResults', 'chunks', 'documents'],
  countKnowledgeBaseHits,
);

import type { ToolProjector } from '../types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** The five buckets a memory search answers with; the card lists all of them. */
const RESULT_BUCKETS = ['activities', 'contexts', 'experiences', 'identities', 'preferences'];

/**
 * `searchUserMemory`.
 *
 * Its card renders the whole result — every memory's title, body and tags — so
 * unlike a tool that shows a summary, there is no subset to keep. What makes it
 * projectable is WHEN: the card mounts with the row's expansion, while the
 * collapsed chip shows one number, the total across the five buckets.
 *
 * So the state is reduced to that number and the rest is fetched on open. The
 * count is pinned rather than recomputed, because the buckets it came from are
 * exactly what got dropped.
 */
export const searchUserMemoryProjector: ToolProjector = ({ pluginState }) => {
  if (!isRecord(pluginState)) return { content: null, storedPayloadNeededBy: 'render' };

  const resultCount = RESULT_BUCKETS.reduce((total, bucket) => {
    const rows = pluginState[bucket];
    return total + (Array.isArray(rows) ? rows.length : 0);
  }, 0);

  return { content: null, pluginState: { resultCount }, storedPayloadNeededBy: 'render' };
};

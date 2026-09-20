import type { UIChatMessage } from '@lobechat/types';
import pMap from 'p-map';

/** Bounded so restoring a long topic can't stampede the API. */
const HYDRATE_CONCURRENCY = 6;

/**
 * Restore the stored body of any tool message the read path projected away,
 * for the ONE consumer that feeds it back to a model.
 *
 * Everything else the store drives is a render, which the view model already
 * satisfies. A resume replay is different: it rebuilds a transcript that the
 * external CLI then resumes from, so an emptied tool result would be written to
 * disk and every later turn would read it back as a tool that returned nothing.
 *
 * Only runs when a GC'd session forces a rebuild, so the fetch cost lands on a
 * path that is already doing far more expensive work.
 */
export const hydrateProjectedToolMessages = async (
  messages: UIChatMessage[] | undefined,
  fetchStoredPayload: (messageId: string) => Promise<{ content: string } | undefined | null>,
): Promise<UIChatMessage[] | undefined> => {
  if (!messages?.length) return messages;

  const projected = messages.filter((m) => m.role === 'tool' && !!m.payloadOmitted);
  if (projected.length === 0) return messages;

  const restored = new Map<string, string>();
  await pMap(
    projected,
    async (m) => {
      try {
        const payload = await fetchStoredPayload(m.id);
        if (typeof payload?.content === 'string') restored.set(m.id, payload.content);
      } catch (error) {
        // Replay the trimmed body rather than failing the turn: a degraded
        // transcript still resumes, a thrown error loses the user's prompt.
        console.error('[resumeReplay] failed to restore tool payload %s: %O', m.id, error);
      }
    },
    { concurrency: HYDRATE_CONCURRENCY },
  );

  if (restored.size === 0) return messages;

  return messages.map((m) => (restored.has(m.id) ? { ...m, content: restored.get(m.id)! } : m));
};

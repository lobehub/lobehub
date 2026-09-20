import type { UIChatMessage } from '@lobechat/types';

export interface StoredToolPayload {
  content: string;
  pluginState?: unknown;
}

export interface HydratedToolMessages {
  messages: UIChatMessage[];
  /** Ids whose stored payload could not be fetched — the row is still projected. */
  missing: string[];
}

/**
 * Put back the stored payload of every tool message the read path projected
 * away, for the consumers that need the real thing rather than a render.
 *
 * Both halves are restored. Projectors reduce `pluginState` as well as the body
 * — a document loses its text and XML, a command its stdout, a crawl its page —
 * so restoring only the body would still hand a lossy row to an export that
 * calls itself lossless.
 *
 * Failures are reported rather than thrown: a resume replay would rather ship a
 * degraded transcript than lose the user's prompt, while an export must refuse
 * to serialize. `missing` lets each caller pick.
 */
export const hydrateProjectedToolMessages = async (
  messages: UIChatMessage[] | undefined,
  fetchStoredPayloads: (messageIds: string[]) => Promise<Record<string, StoredToolPayload>>,
): Promise<HydratedToolMessages> => {
  if (!messages?.length) return { messages: messages ?? [], missing: [] };

  const projected = messages.filter((m) => m.role === 'tool' && !!m.payloadOmitted);
  if (projected.length === 0) return { messages, missing: [] };

  const ids = projected.map((m) => m.id);

  let restored: Record<string, StoredToolPayload> = {};
  try {
    restored = await fetchStoredPayloads(ids);
  } catch (error) {
    console.error(
      '[hydrateProjectedTools] failed to restore %d tool payloads: %O',
      ids.length,
      error,
    );
    return { messages, missing: ids };
  }

  const missing = ids.filter((id) => typeof restored[id]?.content !== 'string');

  return {
    messages: messages.map((m) => {
      const payload = restored[m.id];
      if (typeof payload?.content !== 'string') return m;

      return {
        ...m,
        content: payload.content,
        ...(payload.pluginState !== undefined && { pluginState: payload.pluginState }),
      };
    }),
    missing,
  };
};

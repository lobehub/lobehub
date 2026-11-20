import type { ChatToolPayloadWithResult, UIChatMessage } from '@lobechat/types';

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
/** Ids of the rows whose stored payload has to be fetched back. */
export const selectProjectedToolIds = (messages: UIChatMessage[] | undefined): string[] =>
  (messages ?? []).filter((m) => m.role === 'tool' && !!m.payloadOmitted).map((m) => m.id);

/**
 * Merge a fetched payload map into the CURRENT messages.
 *
 * Kept separate from the fetch so a caller can cache the map — keyed by row id,
 * and therefore still valid as the conversation grows — while merging against
 * whatever the list looks like now. Caching merged messages instead would pin
 * the whole conversation at the moment of the fetch.
 */
export const mergeStoredToolPayloads = (
  messages: UIChatMessage[],
  payloads: Record<string, StoredToolPayload> | undefined,
): HydratedToolMessages => {
  const ids = selectProjectedToolIds(messages);
  if (ids.length === 0) return { messages, missing: [] };

  const restored = payloads ?? {};

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
    missing: ids.filter((id) => typeof restored[id]?.content !== 'string'),
  };
};

export const hydrateProjectedToolMessages = async (
  messages: UIChatMessage[] | undefined,
  fetchStoredPayloads: (messageIds: string[]) => Promise<Record<string, StoredToolPayload>>,
): Promise<HydratedToolMessages> => {
  if (!messages?.length) return { messages: messages ?? [], missing: [] };

  const ids = selectProjectedToolIds(messages);
  if (ids.length === 0) return { messages, missing: [] };

  try {
    return mergeStoredToolPayloads(messages, await fetchStoredPayloads(ids));
  } catch (error) {
    console.error(
      '[hydrateProjectedTools] failed to restore %d tool payloads: %O',
      ids.length,
      error,
    );
    return { messages, missing: ids };
  }
};

/**
 * Ids of every projected tool row in a list, nested lists included
 * (compression groups, compare columns, group members, council blocks).
 */
const collectProjectedToolIds = (
  messages: UIChatMessage[] | undefined,
  ids: Set<string> = new Set(),
): Set<string> => {
  for (const message of messages ?? []) {
    if (message.role === 'tool' && message.payloadOmitted) ids.add(message.id);

    for (const nested of [message.compressedMessages, message.members, ...(message.columns ?? [])])
      collectProjectedToolIds(nested, ids);
    for (const block of message.children ?? []) collectProjectedToolIds(block.council, ids);
  }
  return ids;
};

const restoreToolResult = (
  tool: ChatToolPayloadWithResult,
  payloads: Record<string, StoredToolPayload>,
): ChatToolPayloadWithResult => {
  const id = tool.result_msg_id ?? tool.result?.id;
  const payload = id ? payloads[id] : undefined;
  if (!tool.result || typeof payload?.content !== 'string') return tool;

  return {
    ...tool,
    result: {
      ...tool.result,
      content: payload.content,
      ...(payload.pluginState !== undefined && { state: payload.pluginState }),
    },
  };
};

const restoreDeep = (
  messages: UIChatMessage[],
  payloads: Record<string, StoredToolPayload>,
): UIChatMessage[] =>
  messages.map((message) => {
    const payload = message.role === 'tool' ? payloads[message.id] : undefined;
    const restored =
      typeof payload?.content === 'string'
        ? {
            ...message,
            content: payload.content,
            ...(payload.pluginState !== undefined && { pluginState: payload.pluginState }),
          }
        : message;

    return {
      ...restored,
      ...(restored.children?.length && {
        children: restored.children.map((block) => ({
          ...block,
          ...(block.tools?.length && {
            tools: block.tools.map((tool) => restoreToolResult(tool, payloads)),
          }),
          ...(block.council?.length && { council: restoreDeep(block.council, payloads) }),
        })),
      }),
      ...(restored.columns?.length && {
        columns: restored.columns.map((column) => restoreDeep(column, payloads)),
      }),
      ...(restored.compressedMessages?.length && {
        compressedMessages: restoreDeep(restored.compressedMessages, payloads),
      }),
      ...(restored.members?.length && { members: restoreDeep(restored.members, payloads) }),
    };
  });

/**
 * Restore projected tool payloads in a FOLDED conversation before it becomes
 * an LLM context.
 *
 * A browser-executed run builds its first step from the display list, where a
 * tool result is folded into its assistant group (`children[].tools[].result`)
 * and no longer carries `payloadOmitted`. The ids therefore come from the raw
 * store list (`rawMessages`) as well as the folded one, and the restore walks
 * every place a tool body can sit. Returns the input untouched — no request —
 * when nothing was projected; on a fetch failure it logs and returns the input,
 * matching {@link hydrateProjectedToolMessages}.
 */
export const hydrateProjectedConversation = async (
  messages: UIChatMessage[],
  rawMessages: UIChatMessage[] | undefined,
  fetchStoredPayloads: (messageIds: string[]) => Promise<Record<string, StoredToolPayload>>,
): Promise<UIChatMessage[]> => {
  const ids = [...collectProjectedToolIds(messages, collectProjectedToolIds(rawMessages))];
  if (ids.length === 0) return messages;

  try {
    return restoreDeep(messages, await fetchStoredPayloads(ids));
  } catch (error) {
    console.error(
      '[hydrateProjectedTools] failed to restore %d tool payloads: %O',
      ids.length,
      error,
    );
    return messages;
  }
};

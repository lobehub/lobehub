import type { ChatToolPayloadWithResult, ModelReasoning, UIChatMessage } from '@lobechat/types';

export interface StoredToolPayload {
  content: string;
  pluginState?: unknown;
}

export interface HydratedMessages {
  messages: UIChatMessage[];
  /** Ids whose stored payload or reasoning could not be fetched — the row is still projected. */
  missing: string[];
}

/** True when a row's stored reasoning (text or protocol replay fields) was projected away in SQL. */
export const isOmittedReasoning = (reasoning?: ModelReasoning | null): boolean =>
  !!reasoning?.contentOmitted || !!reasoning?.protocolOmitted;

/** Ids of top-level rows whose stored reasoning has to be fetched back. */
export const selectOmittedReasoningIds = (messages: UIChatMessage[] | undefined): string[] =>
  (messages ?? []).filter((m) => isOmittedReasoning(m.reasoning)).map((m) => m.id);

/** Merge a fetched reasoning map into top-level messages (e.g. export or client transport). */
export const mergeStoredReasonings = (
  messages: UIChatMessage[],
  reasonings: Record<string, ModelReasoning> | undefined,
): HydratedMessages => {
  const ids = selectOmittedReasoningIds(messages);
  if (ids.length === 0) return { messages, missing: [] };

  const restored = reasonings ?? {};

  return {
    messages: messages.map((m) => {
      if (!isOmittedReasoning(m.reasoning)) return m;
      const stored = restored[m.id];
      if (!stored) return m;

      return { ...m, reasoning: stored };
    }),
    missing: ids.filter((id) => !restored[id]),
  };
};

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
): HydratedMessages => {
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
): Promise<HydratedMessages> => {
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

const collectOmittedReasoningIds = (
  messages: UIChatMessage[] | undefined,
  ids: Set<string> = new Set(),
): Set<string> => {
  for (const message of messages ?? []) {
    if (isOmittedReasoning(message.reasoning)) ids.add(message.id);

    for (const nested of [message.compressedMessages, message.members, ...(message.columns ?? [])])
      collectOmittedReasoningIds(nested, ids);
    for (const block of message.children ?? []) {
      if (isOmittedReasoning(block.reasoning)) ids.add(block.id);
      collectOmittedReasoningIds(block.council, ids);
    }
  }
  return ids;
};

const restoreDeep = (
  messages: UIChatMessage[],
  payloads: Record<string, StoredToolPayload>,
  reasonings: Record<string, ModelReasoning> = {},
): UIChatMessage[] =>
  messages.map((message) => {
    const payload = message.role === 'tool' ? payloads[message.id] : undefined;
    const storedReasoning = isOmittedReasoning(message.reasoning)
      ? reasonings[message.id]
      : undefined;
    const restored =
      typeof payload?.content === 'string' || storedReasoning
        ? {
            ...message,
            ...(typeof payload?.content === 'string' && { content: payload.content }),
            ...(payload?.pluginState !== undefined && { pluginState: payload.pluginState }),
            ...(storedReasoning && { reasoning: storedReasoning }),
          }
        : message;

    return {
      ...restored,
      ...(restored.children?.length && {
        children: restored.children.map((block) => {
          const blockReasoning = isOmittedReasoning(block.reasoning)
            ? reasonings[block.id]
            : undefined;
          return {
            ...block,
            ...(blockReasoning && { reasoning: blockReasoning }),
            ...(block.tools?.length && {
              tools: block.tools.map((tool) => restoreToolResult(tool, payloads)),
            }),
            ...(block.council?.length && {
              council: restoreDeep(block.council, payloads, reasonings),
            }),
          };
        }),
      }),
      ...(restored.columns?.length && {
        columns: restored.columns.map((column) => restoreDeep(column, payloads, reasonings)),
      }),
      ...(restored.compressedMessages?.length && {
        compressedMessages: restoreDeep(restored.compressedMessages, payloads, reasonings),
      }),
      ...(restored.members?.length && {
        members: restoreDeep(restored.members, payloads, reasonings),
      }),
    };
  });

/**
 * Restore projected tool payloads (and omitted reasoning blocks, when a
 * fetcher is supplied) in a FOLDED conversation before it becomes an LLM
 * context.
 *
 * A browser-executed run builds its first step from the display list, where a
 * tool result is folded into its assistant group (`children[].tools[].result`)
 * and no longer carries `payloadOmitted`. The ids therefore come from the raw
 * store list (`rawMessages`) as well as the folded one, and the restore walks
 * every place a tool body or reasoning block can sit. Returns the input
 * untouched — no request — when nothing was projected. A tool-payload fetch
 * failure is logged and ignored, matching {@link hydrateProjectedToolMessages}.
 * Omitted reasoning is different: when the reasoning fetch rejects or misses
 * an id, this throws, because sending a placeholder in place of a
 * `signature` / `responseItems` block would silently break the provider's
 * multi-turn replay. `hydrateClientRunContext` turns the throw into a
 * retryable run error.
 */
export const hydrateProjectedConversation = async (
  messages: UIChatMessage[],
  rawMessages: UIChatMessage[] | undefined,
  fetchStoredPayloads: (messageIds: string[]) => Promise<Record<string, StoredToolPayload>>,
  fetchStoredReasonings?: (messageIds: string[]) => Promise<Record<string, ModelReasoning>>,
): Promise<UIChatMessage[]> => {
  const toolIds = [...collectProjectedToolIds(messages, collectProjectedToolIds(rawMessages))];
  const reasoningIds = fetchStoredReasonings
    ? [...collectOmittedReasoningIds(messages, collectOmittedReasoningIds(rawMessages))]
    : [];

  if (toolIds.length === 0 && reasoningIds.length === 0) return messages;

  const [payloads, reasonings] = await Promise.all([
    toolIds.length > 0
      ? fetchStoredPayloads(toolIds).catch((error) => {
          console.error(
            '[hydrateProjectedTools] failed to restore %d tool payloads: %O',
            toolIds.length,
            error,
          );
          return {};
        })
      : Promise.resolve<Record<string, StoredToolPayload>>({}),
    reasoningIds.length > 0 && fetchStoredReasonings
      ? fetchStoredReasonings(reasoningIds)
      : Promise.resolve<Record<string, ModelReasoning>>({}),
  ]);

  if (reasoningIds.length > 0 && fetchStoredReasonings) {
    const missingReasoningIds = reasoningIds.filter((id) => !reasonings[id]);
    if (missingReasoningIds.length > 0) {
      throw new Error(
        `Failed to restore omitted reasoning for ${missingReasoningIds.length} message(s) before browser execution`,
      );
    }
  }

  if (Object.keys(payloads).length === 0 && Object.keys(reasonings).length === 0) return messages;

  return restoreDeep(messages, payloads, reasonings);
};

import type { ChatToolPayloadWithResult, UIChatMessage } from '@lobechat/types';

const GROUP_ROLES = new Set<UIChatMessage['role']>(['assistantGroup', 'supervisor']);

/**
 * Unfold the display list back into the flat user / assistant / tool sequence
 * the text exports serialize.
 *
 * The display list folds an assistant turn — every step and tool result — into
 * one `assistantGroup` (or `supervisor`) row whose own `content` is empty; the
 * text lives in `children`. Serialized as-is, a Markdown or PDF export keeps
 * only the user's side of the conversation. Unfolding the display list rather
 * than reading the raw rows keeps the branch the conversation actually shows.
 *
 * A tool row is taken from the raw store rows when present, so a projected
 * result keeps its `payloadOmitted` mark and `useExportMessages` can restore
 * the stored body before it is serialized.
 */
export const flattenExportMessages = (
  messages: UIChatMessage[],
  rawMessages: UIChatMessage[] = [],
): UIChatMessage[] => {
  const rawById = new Map(rawMessages.map((message) => [message.id, message]));

  const toToolMessage = (
    tool: ChatToolPayloadWithResult,
    group: UIChatMessage,
  ): UIChatMessage[] => {
    const id = tool.result_msg_id ?? tool.result?.id;
    if (!id || !tool.result) return [];

    const raw = rawById.get(id);
    if (raw) return [raw];

    return [
      {
        content: tool.result.content ?? '',
        createdAt: group.createdAt,
        id,
        plugin: tool,
        role: 'tool',
        tool_call_id: tool.id,
        updatedAt: group.updatedAt,
      },
    ];
  };

  const flatten = (list: UIChatMessage[]): UIChatMessage[] =>
    list.flatMap((message) => {
      if (!GROUP_ROLES.has(message.role) || !message.children?.length) return [message];

      return message.children.flatMap((block) => {
        if (block.council?.length) return flatten(block.council);

        const assistant: UIChatMessage = {
          ...message,
          children: undefined,
          content: block.content,
          id: block.id,
          role: 'assistant',
          // The result is serialized as its own tool row right after.
          tools: block.tools?.map(({ result: _result, ...tool }) => tool),
        };

        return [assistant, ...(block.tools ?? []).flatMap((tool) => toToolMessage(tool, message))];
      });
    });

  return flatten(messages);
};

import type { AssistantContentBlock, UIChatMessage } from '@lobechat/types';

export interface ResolvedAssistantGroup {
  assistantId: string;
  blocks: AssistantContentBlock[];
  instruction?: string;
}

/**
 * Resolve assistant group blocks from a thread/conversation message list.
 * Prefers `role === 'assistantGroup'` children; falls back to a plain `assistant` message as a single block.
 */
export function resolveAssistantGroupFromMessages(
  messages: UIChatMessage[] | undefined | null,
): ResolvedAssistantGroup {
  if (!messages || messages.length === 0) {
    return { assistantId: '', blocks: [] };
  }

  const assistantGroupMessage = messages.find((item) => item.role === 'assistantGroup');
  const userMessage = messages.find((item) => item.role === 'user');

  if (assistantGroupMessage) {
    return {
      assistantId: assistantGroupMessage.id ?? '',
      blocks: assistantGroupMessage.children ?? [],
      instruction: userMessage?.content,
    };
  }

  const assistantMessage = messages.find((item) => item.role === 'assistant');
  if (assistantMessage) {
    const block: AssistantContentBlock = {
      content: assistantMessage.content || '',
      id: assistantMessage.id,
    };

    if (assistantMessage.error) block.error = assistantMessage.error;
    if (assistantMessage.reasoning) block.reasoning = assistantMessage.reasoning;

    return {
      assistantId: assistantMessage.id ?? '',
      blocks: [block],
      instruction: userMessage?.content,
    };
  }

  return { assistantId: '', blocks: [] };
}

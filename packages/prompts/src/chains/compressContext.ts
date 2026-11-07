import type { ChatStreamPayload, UIChatMessage } from '@lobechat/types';

import {
  chatHistoryPrompts,
  compressContextSystemPrompt,
  compressContextUserPrompt,
} from '../prompts';

/**
 * Chain for compressing conversation context into a summary
 * Used when conversation history exceeds token threshold
 */
export const chainCompressContext = (
  messages: UIChatMessage[],
  existingSummary?: string,
): Partial<ChatStreamPayload> => ({
  messages: [
    {
      content: compressContextSystemPrompt,
      role: 'system',
    },
    {
      content: `${existingSummary ? `Existing conversation summary:\n${existingSummary}\n\nNew conversation history:\n` : ''}${chatHistoryPrompts(messages)}

${compressContextUserPrompt}`,
      role: 'user',
    },
  ],
});

interface ConversationMessage {
  content?: unknown;
  name?: string;
  role?: string;
  tool_calls?: Array<{ function?: { arguments?: string; name?: string } }>;
}

const renderContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return (content as Array<{ text?: string; type?: string }>)
    .map((part) =>
      part?.type === 'text' ? (part.text ?? '') : `[${part?.type?.replace(/_url$/, '')}]`,
    )
    .filter(Boolean)
    .join('\n');
};

const renderConversationMessage = (message: ConversationMessage) => {
  const content = renderContent(message.content);

  if (message.role === 'tool') {
    const name = message.name ? ` name="${message.name}"` : '';
    return `<tool_result${name}>${content}</tool_result>`;
  }

  const toolCalls = (message.tool_calls ?? []).map(
    (call) =>
      `<tool_call name="${call.function?.name ?? ''}">${call.function?.arguments ?? ''}</tool_call>`,
  );

  return `<${message.role}>${[content, ...toolCalls].filter(Boolean).join('\n')}</${message.role}>`;
};

/**
 * Chain for compressing the conversation as the model actually received it:
 * the context engine's output for the turn being compressed, after it trimmed
 * stale tool output and truncated history. System messages (system role,
 * tool instructions) are left out — they are rebuilt on every request and
 * must not be baked into the summary. A previous summary arrives inside the
 * history as a `<compressed_history_summary>` block.
 */
export const chainCompressConversation = (messages: unknown[]): Partial<ChatStreamPayload> => {
  const history = (messages as ConversationMessage[])
    .filter((message) => message?.role && message.role !== 'system')
    .map(renderConversationMessage)
    .join('\n');

  return {
    messages: [
      { content: compressContextSystemPrompt, role: 'system' },
      {
        content: `Conversation history (a previous summary, if any, is in <compressed_history_summary>; fold it into the new summary. Context blocks the application injected, such as user memory or referenced documents, are background, not conversation):
<chat_history>
${history}
</chat_history>

${compressContextUserPrompt}`,
        role: 'user',
      },
    ],
  };
};

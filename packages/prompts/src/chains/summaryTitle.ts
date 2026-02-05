import type { ChatStreamPayload, OpenAIChatMessage, UIChatMessage } from '@lobechat/types';

export const chainSummaryTitle = (
  messages: (UIChatMessage | OpenAIChatMessage)[],
  locale: string,
): Partial<ChatStreamPayload> => ({
  messages: [
    {
      content: `You are a professional conversation summarizer. Generate a concise title that captures the essence of the conversation.

Rules:
- Output ONLY the title text, no explanations or additional context
- Maximum 10 words
- Maximum 50 characters
- No punctuation marks
- Use the language specified by the locale code: ${locale}
- The title should accurately reflect the main topic of the conversation
- Keep it short and to the point`,
      role: 'system',
    },
    {
      content: messages.map((message) => `${message.role}: ${message.content}`).join('\n'),
      role: 'user',
    },
  ],
});

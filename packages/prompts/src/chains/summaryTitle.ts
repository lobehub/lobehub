import type { ChatStreamPayload, OpenAIChatMessage, UIChatMessage } from '@lobechat/types';

export const chainSummaryTitle = (
  messages: (UIChatMessage | OpenAIChatMessage)[],
  locale: string,
): Partial<ChatStreamPayload> => {
  const conversationText = messages
    .map((message) => `<${message.role}>\n${String(message.content ?? '')}\n</${message.role}>`)
    .join('\n');

  return {
    messages: [
      {
        content: `You are a professional conversation summarizer. Generate a concise title that captures the essence of the conversation.

Rules:
- Output ONLY the title text, no explanations or additional context
- Maximum 15 words
- Maximum 80 characters
- No punctuation marks
- Use the language specified by the locale code: ${locale}
- The title should accurately reflect the main topic of the conversation
- Keep it short and to the point`,
        role: 'system',
      },
      {
        content: `<task>\nGenerate a concise title that captures the essence of the conversation.\n</task>\n\n<conversation>\n${conversationText}\n</conversation>`,
        role: 'user',
      },
    ],
  };
};

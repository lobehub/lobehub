import type { OpenAIChatMessage, UIChatMessage } from '@lobechat/types';

export const TOPIC_TITLE_PROMPT_VERSION = 'v1';

export const TOPIC_TITLE_JSON_SCHEMA = {
  name: 'topic_title',
  schema: {
    additionalProperties: false,
    properties: {
      title: { description: 'A concise topic title', type: 'string' },
    },
    required: ['title'],
    type: 'object' as const,
  },
  strict: true,
};

export const chainSummaryTitle = (
  messages: (UIChatMessage | OpenAIChatMessage)[],
  locale: string,
): { messages: Array<{ content: string; role: 'system' | 'user' }> } => {
  const conversationText = messages
    .map((message) => `<${message.role}>\n${String(message.content ?? '')}\n</${message.role}>`)
    .join('\n');

  return {
    messages: [
      {
        content: `You are a professional conversation summarizer. Generate a concise title that captures the essence of the conversation.

Rules:
- Return one JSON object with a single "title" string matching the supplied schema
- No explanations or additional fields
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

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

/**
 * The output contract differs by transport. Streaming consumers persist the
 * response text as the title itself, while `generateObject` consumers supply
 * TOPIC_TITLE_JSON_SCHEMA and read the parsed `title` field.
 */
const PLAIN_TEXT_RULE = '- Output ONLY the title text, no explanations or additional context';
const JSON_OBJECT_RULE = [
  '- Return one JSON object with a single "title" string matching the supplied schema',
  '- No explanations or additional fields',
].join('\n');

const buildTitleMessages = (
  messages: (UIChatMessage | OpenAIChatMessage)[],
  locale: string,
  outputRule: string,
): { messages: Array<{ content: string; role: 'system' | 'user' }> } => {
  const conversationText = messages
    .map((message) => `<${message.role}>\n${String(message.content ?? '')}\n</${message.role}>`)
    .join('\n');

  return {
    messages: [
      {
        content: `You are a professional conversation summarizer. Generate a concise title that captures the essence of the conversation.

Rules:
${outputRule}
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

/**
 * Title prompt for streaming consumers, whose response text is written to the
 * title verbatim — so it must not be wrapped in an object.
 */
export const chainSummaryTitle = (
  messages: (UIChatMessage | OpenAIChatMessage)[],
  locale: string,
): { messages: Array<{ content: string; role: 'system' | 'user' }> } =>
  buildTitleMessages(messages, locale, PLAIN_TEXT_RULE);

/**
 * Title prompt for `generateObject` consumers, paired with TOPIC_TITLE_JSON_SCHEMA.
 */
export const chainSummaryTitleStructured = (
  messages: (UIChatMessage | OpenAIChatMessage)[],
  locale: string,
): { messages: Array<{ content: string; role: 'system' | 'user' }> } =>
  buildTitleMessages(messages, locale, JSON_OBJECT_RULE);

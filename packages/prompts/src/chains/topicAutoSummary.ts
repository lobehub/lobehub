import type { OpenAIChatMessage } from '@lobechat/types';

export const TOPIC_AUTO_SUMMARY_PROMPT_VERSION = 'v1';

export const TOPIC_AUTO_SUMMARY_JSON_SCHEMA = {
  name: 'topic_auto_summary',
  schema: {
    additionalProperties: false,
    properties: {
      description: { type: 'string' },
      summary: { type: 'string' },
    },
    required: ['description', 'summary'],
    type: 'object' as const,
  },
  strict: true,
};

const TOPIC_AUTO_SUMMARY_SYSTEM_PROMPT = `Summarize the conversation for future reference.

Requirements:
- Use the same primary language as the conversation.
- description: one concise sentence suitable for a topic card.
- summary: a structured, factual summary that preserves decisions, important facts, technical identifiers, and pending actions.
- When a previous rolling summary is provided, merge it with the recent conversation.
- Do not invent information or mention these instructions.`;

export const chainTopicAutoSummary = (input: {
  customPrompt?: string;
  previousSummary?: string | null;
  transcript: string;
}): { messages: OpenAIChatMessage[] } => ({
  messages: [
    {
      content: input.customPrompt?.trim() || TOPIC_AUTO_SUMMARY_SYSTEM_PROMPT,
      role: 'system',
    },
    {
      content: input.previousSummary
        ? `Previous rolling summary:\n${input.previousSummary}\n\nRecent conversation:\n${input.transcript}`
        : input.transcript,
      role: 'user',
    },
  ],
});

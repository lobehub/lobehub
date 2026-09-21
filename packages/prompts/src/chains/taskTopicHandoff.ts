import type { ChatStreamPayload } from '@lobechat/types';

/**
 * Bump when editing the system prompt or schema below. Plumbed through
 * `tracing.promptVersion` at the call site so per-call tracing groups runs
 * by prompt iteration.
 */
export const TASK_TOPIC_HANDOFF_PROMPT_VERSION = 'v1.1';

export const TASK_TOPIC_HANDOFF_SCHEMA_NAME = 'task_topic_handoff';

/**
 * Generate a handoff summary for a completed task topic.
 * Returns both a title and structured handoff data for the next topic.
 *
 * Input: the last assistant message content from the topic.
 * Output: JSON with { title, summary, keyFindings?, nextAction? }
 */
export const chainTaskTopicHandoff = (params: {
  lastAssistantContent: string;
  responseLanguage?: string;
  taskInstruction: string;
  taskName: string;
}): Partial<ChatStreamPayload> => {
  const languageInstruction = params.responseLanguage
    ? `Output language: ${params.responseLanguage}. Always use this language for title and summary regardless of the content language.`
    : 'Use the same language as the content.';

  return {
    messages: [
      {
        content: `You are a task execution summarizer. A topic (one round of agent execution) has just completed within a task. Generate a handoff summary for the next topic to read.

Output a JSON object with these fields:
- "title": The headline result of this topic (max 50 chars): what was found, decided or delivered, readable on its own
- "summary": A 1-3 sentence summary of what was done and the key outcome
- "keyFindings": An array of key findings or decisions made (optional, max 5 items)
- "nextAction": What the next topic should do (optional, 1 sentence)

Rules:
- Focus on WHAT WAS ACCOMPLISHED, not what was asked
- ${languageInstruction}
- The title states the result itself, not that work happened: never a status such as "Completed X", "Task done" or "完成 X". If the response opens with an explicit conclusion line, condense that line into the title
- Keep title short and specific
- summary should capture the essential outcome a new topic needs to know
- Output ONLY the JSON object, no markdown fences or explanations`,
        role: 'system',
      },
      {
        content: `Task: ${params.taskName}
Task instruction: ${params.taskInstruction}

Last assistant response:
${params.lastAssistantContent}`,
        role: 'user',
      },
    ],
  };
};

export const TASK_TOPIC_HANDOFF_SCHEMA = {
  additionalProperties: false,
  properties: {
    keyFindings: {
      items: { type: 'string' },
      type: 'array',
    },
    nextAction: { type: 'string' },
    summary: { type: 'string' },
    title: { type: 'string' },
  },
  required: ['title', 'summary', 'keyFindings', 'nextAction'],
  type: 'object' as const,
};

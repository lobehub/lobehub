import type { ChatStreamPayload } from '@lobechat/types';

/**
 * Generate a handoff summary for a completed task topic.
 * Returns both a title and structured handoff data for the next topic.
 *
 * Input: the last assistant message content from the topic.
 * Output: JSON with { title, summary, keyFindings?, nextAction? }
 */
export const chainTaskTopicHandoff = (params: {
  lastAssistantContent: string;
  taskInstruction: string;
  taskName: string;
}): Partial<ChatStreamPayload> => ({
  messages: [
    {
      content: `You are a task execution summarizer. A topic (one round of agent execution) has just completed within a task. Generate a handoff summary for the next topic to read.

Output a JSON object with these fields:
- "title": A concise title summarizing what this topic accomplished (max 50 chars, same language as content)
- "summary": A 1-3 sentence summary of what was done and the key outcome
- "keyFindings": An array of key findings or decisions made (optional, max 5 items)
- "nextAction": What the next topic should do (optional, 1 sentence)

Rules:
- Focus on WHAT WAS ACCOMPLISHED, not what was asked
- Use the same language as the content
- Keep title short and specific (e.g. "制定8章书籍大纲" not "完成任务")
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
});

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
  required: ['title', 'summary'],
  type: 'object' as const,
};

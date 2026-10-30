import type { ChatStreamPayload } from '@lobechat/types';

/**
 * Bump when editing the system prompt or schema below. Plumbed through
 * `tracing.promptVersion` at the call site so per-call tracing groups runs
 * by prompt iteration.
 */
export const TASK_TOPIC_HANDOFF_PROMPT_VERSION = 'v1.2';

export const TASK_TOPIC_HANDOFF_SCHEMA_NAME = 'task_topic_handoff';

/**
 * Generate a handoff summary for a completed task topic.
 * Returns both a title and structured handoff data for the next topic.
 *
 * Input: the last assistant message content from the topic, plus the run's
 * earlier report when the last message may only be a trailing remark after it.
 * Output: JSON with { title, summary, keyFindings?, nextAction, finalIsTrailingRemark }
 */
export const chainTaskTopicHandoff = (params: {
  /** The run's longest earlier reply, when it is clearly longer than the last one. */
  earlierReport?: string;
  lastAssistantContent: string;
  responseLanguage?: string;
  taskInstruction: string;
  taskName: string;
}): Partial<ChatStreamPayload> => {
  const languageInstruction = params.responseLanguage
    ? `Output language: ${params.responseLanguage}. Always use this language for title and summary regardless of the content language.`
    : 'Use the same language as the content.';

  const earlierReportRules = params.earlierReport
    ? `
- An earlier report from the same run is included. The last response is the outcome by default. When it is only a trailing remark after that report, base title, summary and keyFindings on the earlier report and set "finalIsTrailingRemark" to true. Trailing remarks include acknowledging a background job that finished, describing cleanup, or saying the results above are unchanged. A trailing remark never means the run delivered nothing
- Set "finalIsTrailingRemark" to false when the last response reports its own outcome, including one that replaces or corrects the earlier report`
    : `
- Set "finalIsTrailingRemark" to false`;

  const earlierReportBlock = params.earlierReport
    ? `Earlier report from this run:
${params.earlierReport}

`
    : '';

  return {
    messages: [
      {
        content: `You are a task execution summarizer. A topic (one round of agent execution) has just completed within a task. Generate a handoff summary for the next topic to read.

Output a JSON object with these fields:
- "title": The headline result of this topic (max 50 chars): what was found, decided or delivered, readable on its own
- "summary": A 1-3 sentence summary of what was done and the key outcome
- "keyFindings": An array of key findings or decisions made (optional, max 5 items)
- "nextAction": What the next topic should do (optional, 1 sentence)
- "finalIsTrailingRemark": Whether the last response is only a trailing remark after the run's earlier report

Rules:
- Focus on WHAT WAS ACCOMPLISHED, not what was asked
- ${languageInstruction}
- The title states the result itself, not that work happened: never a status such as "Completed X", "Task done" or "完成 X". If the response opens with an explicit conclusion line, condense that line into the title
- Keep title short and specific
- summary should capture the essential outcome a new topic needs to know
- Output ONLY the JSON object, no markdown fences or explanations${earlierReportRules}`,
        role: 'system',
      },
      {
        content: `Task: ${params.taskName}
Task instruction: ${params.taskInstruction}

${earlierReportBlock}Last assistant response:
${params.lastAssistantContent}`,
        role: 'user',
      },
    ],
  };
};

export const TASK_TOPIC_HANDOFF_SCHEMA = {
  additionalProperties: false,
  properties: {
    finalIsTrailingRemark: { type: 'boolean' },
    keyFindings: {
      items: { type: 'string' },
      type: 'array',
    },
    nextAction: { type: 'string' },
    summary: { type: 'string' },
    title: { type: 'string' },
  },
  required: ['title', 'summary', 'keyFindings', 'nextAction', 'finalIsTrailingRemark'],
  type: 'object' as const,
};

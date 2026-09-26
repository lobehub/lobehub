export interface BuildTopicPromptParams {
  id: string;
  title?: string;
}

/**
 * A pasteable hand-off prompt for another agent (e.g. Claude Code) that points
 * it at this topic and tells it how to read the full history via the LobeHub CLI.
 */
export const buildTopicPrompt = ({ id, title }: BuildTopicPromptParams) =>
  [
    `LobeHub topic: ${title?.trim() ? `${title.trim()} (${id})` : id}`,
    '',
    'Use the LobeHub CLI to read the full conversation history of this topic:',
    '',
    `lh topic view ${id} -L 500`,
    '',
    'If the topic has more than 500 messages, page through the remainder with --from and --to.',
  ].join('\n');

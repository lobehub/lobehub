const GOAL_COMMAND_PATTERN = /^\s*\/goal(?:\s|$)/i;

/** Whether a user prompt explicitly requests the canonical goal workflow. */
export const isGoalPrompt = (prompt: unknown): boolean =>
  typeof prompt === 'string' && GOAL_COMMAND_PATTERN.test(prompt);

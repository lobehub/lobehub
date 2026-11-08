const GOAL_COMMAND_PATTERN = /^\s*\/goal(?:\s|$)/i;

/** Whether a user prompt explicitly requests the canonical goal workflow. */
export const isGoalPrompt = (prompt: unknown): boolean =>
  typeof prompt === 'string' && GOAL_COMMAND_PATTERN.test(prompt);

/**
 * The prompt a heterogeneous CLI agent receives for a `/goal` message: the
 * request without its leading `/goal`.
 *
 * Claude Code ships its own `/goal` slash command. Sent verbatim, the user's
 * message is taken over by it — it pins a session goal and installs a stop
 * hook that refuses to end the run until the work is done, while LobeHub's goal
 * waits for that same run to end before dispatching the work. The LobeHub
 * instructions travel in the system context; the prompt only carries the ask.
 * Other prompts pass through unchanged.
 */
export const stripGoalCommand = <T>(prompt: T): T =>
  typeof prompt === 'string' && GOAL_COMMAND_PATTERN.test(prompt)
    ? (prompt.replace(GOAL_COMMAND_PATTERN, '').trimStart() as T)
    : prompt;

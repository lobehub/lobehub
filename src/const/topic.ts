/**
 * Well-known `topic.trigger` values used to segment system-owned topics.
 *
 * `RunTask` is what `TaskRunnerService` writes when starting an agent run for
 * a task; the literal `'task'` is intentional and matches existing DB rows.
 * `Document` marks topics auto-provisioned for an agent ↔ document chat panel
 * (see `agentDocument.getOrCreateChatTopic`); these are surfaced through the
 * document UI and should stay out of the main agent chat history.
 */
export const TopicTrigger = {
  Cron: 'cron',
  Document: 'document',
  Eval: 'eval',
  RunTask: 'task',
} as const;

/**
 * Triggers to exclude from the main chat sidebar so system-owned topics
 * (cron jobs, evals, task runs, doc-anchored chat) don't pollute the user's
 * main history.
 */
export const MAIN_SIDEBAR_EXCLUDE_TRIGGERS: string[] = [
  TopicTrigger.Cron,
  TopicTrigger.Document,
  TopicTrigger.Eval,
  TopicTrigger.RunTask,
];

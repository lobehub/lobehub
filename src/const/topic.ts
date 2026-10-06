/**
 * Well-known `topic.trigger` values used to segment system-owned topics.
 *
 * `RunTask` is what `TaskRunnerService` writes when starting an agent run for
 * a task; the literal `'task'` is intentional and matches existing DB rows.
 * `Document` marks topics auto-provisioned for an agent ↔ document chat panel
 * (see `agentDocument.getOrCreateChatTopic`); these are surfaced through the
 * document UI and should stay out of the main agent chat history.
 * `GoalSupervision` marks the conversation a goal's supervising agent plans in
 * (and the recovery supervisor's); it is read from the goal page's supervision
 * panel, not from the agent's chat history.
 */
export const TopicTrigger = {
  Cron: 'cron',
  Document: 'document',
  Eval: 'eval',
  GoalSupervision: 'goal_supervision',
  RunTask: 'task',
} as const;

/**
 * Triggers to exclude from the main chat sidebar so system-owned topics
 * (cron jobs, evals, task runs, doc-anchored chat, goal supervision) don't
 * pollute the user's main history.
 */
export const MAIN_SIDEBAR_EXCLUDE_TRIGGERS: string[] = [
  TopicTrigger.Cron,
  TopicTrigger.Document,
  TopicTrigger.Eval,
  TopicTrigger.GoalSupervision,
  TopicTrigger.RunTask,
];

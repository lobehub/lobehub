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
 * `Channel` marks an agent's execution context for a Channel conversation;
 * its messages are surfaced through the Channel UI.
 * `Webhook` marks a topic a generic inbound webhook call started; it is read
 * from Inbox, the topic manager and the webhook's delivery log.
 * `SubTopic` marks a topic another topic opened for an agent through
 * `lobe-topic.openTopic` / `lh topic send --new` from inside a conversation. It is listed under its
 * opener (`metadata.openedBy`), not in the target agent's own history, unless
 * that agent's list asks to show sessions others opened for it.
 */
export const TopicTrigger = {
  Channel: 'channel',
  Cron: 'cron',
  Document: 'document',
  Eval: 'eval',
  GoalSupervision: 'goal_supervision',
  RunTask: 'task',
  SubTopic: 'sub_topic',
  Webhook: 'webhook',
} as const;

/**
 * Triggers to exclude from the main chat sidebar so system-owned topics
 * (channel runs, cron jobs, evals, task runs, doc chats, goal supervision,
 * webhook calls, sub-topics opened by another topic) don't
 * pollute the user's main history.
 */
export const MAIN_SIDEBAR_EXCLUDE_TRIGGERS: string[] = [
  TopicTrigger.Channel,
  TopicTrigger.Cron,
  TopicTrigger.Document,
  TopicTrigger.Eval,
  TopicTrigger.GoalSupervision,
  TopicTrigger.RunTask,
  TopicTrigger.SubTopic,
  TopicTrigger.Webhook,
];

/**
 * The main sidebar's exclusions when the agent's list asks to show the
 * sub-topics other conversations opened for it.
 */
export const MAIN_SIDEBAR_EXCLUDE_TRIGGERS_WITH_OPENED_FOR_ME: string[] =
  MAIN_SIDEBAR_EXCLUDE_TRIGGERS.filter((trigger) => trigger !== TopicTrigger.SubTopic);

/**
 * Single source of truth for the CC subagent inspector-chip metrics.
 *
 * Both the live path (chip selector aggregating the in-memory streamed child
 * messages) and the cold-load path (server `threadModel.queryByTopicId`
 * aggregating the persisted rows in SQL) compute the SAME projection over the
 * SAME messages — so the two can't diverge by construction. This TS helper is
 * the live encoding; the SQL encoding mirrors it (SUM of assistant
 * `usage.totalTokens`, COUNT of `role='tool'`, a pinned model).
 *
 * `totalTokens` is a plain SUM of each turn's `usage.totalTokens` — the same
 * convention as the project's token-usage heatmap (`MessageModel`), i.e. "total
 * tokens processed", not "final context size". CC re-feeds the growing context
 * each turn so the sum is dominated by (mostly cached) context re-reads, which
 * is exactly what the heatmap counts too.
 */

interface MetricMessage {
  metadata?: { usage?: { totalTokens?: number | null } | null } | null;
  model?: string | null;
  role?: string | null;
  usage?: { totalTokens?: number | null } | null;
}

export interface SubagentMetrics {
  /** Model the subagent ran on (first assistant turn that carries one). */
  model?: string;
  /** Number of `role='tool'` child messages. */
  toolCalls: number;
  /** Sum of every assistant turn's `usage.totalTokens`. */
  totalTokens: number;
}

export const aggregateSubagentMetrics = (messages: MetricMessage[]): SubagentMetrics => {
  let toolCalls = 0;
  let totalTokens = 0;
  let model: string | undefined;

  for (const m of messages) {
    if (m.role === 'tool') {
      toolCalls += 1;
    } else if (m.role === 'assistant') {
      // dbMessagesMap holds the raw DB shape (`metadata.usage`); the
      // display-bound UIChatMessage promotes it to a top-level `usage` — accept
      // either so the same helper serves both call sites.
      totalTokens += m.usage?.totalTokens ?? m.metadata?.usage?.totalTokens ?? 0;
      if (!model && m.model) model = m.model;
    }
  }

  return { model, toolCalls, totalTokens };
};

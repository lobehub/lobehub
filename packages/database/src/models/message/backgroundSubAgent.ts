import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { messagePlugins, messages } from '../../schemas';
import { MessageScope } from './scope';

/**
 * Bookkeeping of background sub-agent calls (`callSubAgent` / `callAgent` with
 * `runInBackground`): which are still running, and which finished results are
 * waiting to be handed to their parent agent.
 */
export class MessageBackgroundSubAgentQueries extends MessageScope {
  /**
   * Background sub-agent calls in a topic — tool rows whose `state.background`
   * is set (`callSubAgent` / `callAgent` with `runInBackground`; only their
   * runner writes the flag).
   *
   * - `running`: the sub-agent has not reported back yet (`state.status` is
   *   `pending`). Used to cap how many run at once.
   * - `undelivered`: it finished (`completed` / `error`) but its result has not
   *   been handed to the parent yet (`state.deliveredAt` unset), oldest first.
   */
  listBackgroundSubAgentCalls = async (params: {
    scope: 'running' | 'undelivered';
    topicId: string;
  }): Promise<
    {
      agentId: string | null;
      arguments: string | null;
      id: string;
      state: Record<string, any>;
      threadId: string | null;
    }[]
  > => {
    const statusCondition =
      params.scope === 'running'
        ? sql`${messagePlugins.state}->>'status' = 'pending'`
        : and(
            sql`${messagePlugins.state}->>'status' in ('completed', 'error')`,
            sql`not coalesce(jsonb_exists(${messagePlugins.state}, 'deliveredAt'), false)`,
          );

    const rows = await this.db
      .select({
        agentId: messages.agentId,
        arguments: messagePlugins.arguments,
        id: messages.id,
        state: messagePlugins.state,
        threadId: messages.threadId,
      })
      .from(messagePlugins)
      .innerJoin(messages, eq(messagePlugins.id, messages.id))
      .where(
        and(
          eq(messages.topicId, params.topicId),
          sql`coalesce(${messagePlugins.state}->>'background', '') = 'true'`,
          statusCondition,
          this.ownership(),
          this.pluginsOwnership(),
        ),
      )
      .orderBy(asc(messages.createdAt), asc(messages.id));

    return rows.map((row) => ({ ...row, state: (row.state ?? {}) as Record<string, any> }));
  };

  /**
   * Claim finished background sub-agent results for delivery: stamps
   * `state.deliveredAt` on the rows that do not carry it yet and returns their
   * ids. Two deliveries racing for the same row cannot both win it.
   */
  claimBackgroundSubAgentDelivery = async (
    ids: string[],
    deliveredAt: string,
  ): Promise<string[]> => {
    if (ids.length === 0) return [];

    const claimed = await this.db
      .update(messagePlugins)
      .set({
        state: sql`coalesce(${messagePlugins.state}, '{}'::jsonb) || ${JSON.stringify({ deliveredAt })}::jsonb`,
      })
      .where(
        and(
          inArray(messagePlugins.id, ids),
          sql`not coalesce(jsonb_exists(${messagePlugins.state}, 'deliveredAt'), false)`,
          this.pluginsOwnership(),
        ),
      )
      .returning({ id: messagePlugins.id });

    return claimed.map((row) => row.id);
  };

  /** Hand claimed background results back, so a later delivery retries them. */
  releaseBackgroundSubAgentDelivery = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;

    await this.db
      .update(messagePlugins)
      .set({ state: sql`${messagePlugins.state} - 'deliveredAt'` })
      .where(and(inArray(messagePlugins.id, ids), this.pluginsOwnership()));
  };
}

import { and, desc, eq, isNull, not, sql } from 'drizzle-orm';

import { messages } from '../../schemas';
import { MessageScope } from './scope';

export class MessageSpineQueries extends MessageScope {
  /**
   * Id of the latest main-thread (`threadId IS NULL`) "spine" message in a
   * topic: the most recent message that is NOT a tool and NOT a signal-tagged
   * reactive turn (Monitor stdout callbacks etc.). This is the chain anchor for
   * the heterogeneous-agent write side: the next normal
   * turn parents off it, producing a `user → asst → asst …` spine with tools as
   * inline children.
   *
   * Read straight from the DB and ordered by `createdAt`, it is independent of
   * the in-memory current-assistant pointer — which can regress to the run's
   * seed placeholder on a cold / non-sticky serverless replica. Anchoring here
   * instead keeps consecutive cold-replica steps chained linearly rather than
   * forking onto a stale node (the remote "断链" bug). No `createdAt` floor is
   * needed for a topic-wide conversation tail. An in-flight run must pass its
   * operationId to getLatestSpineMessageId so late writes from another run
   * cannot become its continuation point.
   *
   * Excludes `role:'tool'` (inline children) and TOOLLESS signal-tagged
   * assistants (`metadata->'signal'` with no tools), which are tool-child
   * callbacks — anchoring a normal turn onto a callback would orphan it under
   * the read side's tool-only signal collection. A signal turn that DID emit
   * tools is back on the main chain and stays a spine candidate.
   */
  getLastMainThreadSpineMessageId = async (topicId: string): Promise<string | undefined> =>
    this.getLatestSpineMessageId({ topicId, threadId: null });

  /**
   * Whether `descendantId` belongs to the branch rooted at `ancestorId`.
   *
   * Used when reconciling a client-selected conversation tail with the latest
   * server row: a newer row may be a sibling from a historical callback fork,
   * not an advancement of the branch the user is viewing.
   */
  isMessageDescendantOf = async ({
    ancestorId,
    descendantId,
    topicId,
  }: {
    ancestorId: string;
    descendantId: string;
    topicId: string;
  }): Promise<boolean> => {
    const result = await this.db.execute(sql`
      WITH RECURSIVE ancestors(id, parent_id) AS (
        SELECT id, parent_id
        FROM messages
        WHERE id = ${descendantId}
          AND topic_id = ${topicId}
          AND ${this.ownership()}
        UNION
        SELECT parent.id, parent.parent_id
        FROM messages parent
        JOIN ancestors child ON parent.id = child.parent_id
        WHERE parent.topic_id = ${topicId}
      )
      SELECT 1 AS hit FROM ancestors WHERE id = ${ancestorId} LIMIT 1
    `);

    return result.rows.length > 0;
  };

  /**
   * Thread-aware variant of {@link getLastMainThreadSpineMessageId}: the id of
   * the latest "spine" message (the most recent message that is NOT a tool and
   * NOT a signal-tagged reactive turn) in a topic, scoped to the main thread
   * (`threadId IS NULL`) or to a specific thread.
   *
   * Like the main-thread query it EXCLUDES `role:'tool'` and TOOLLESS
   * signal-tagged assistants: tools are inline children of their assistant turn,
   * so the conversation head a new turn parents off is the assistant, never the
   * tool result that landed under it. A tools-bearing signal turn is main-chain
   * and remains a spine candidate.
   *
   * Used by `sendMessageInServer` to make `parentId` server-authoritative and
   * close the concurrent-append race: the client computes `parentId` from a
   * local snapshot whose spine tail may already have advanced (e.g. another
   * assistant turn was written while the user was composing), so trusting it
   * would fork the new turn off a stale node. Heterogeneous step recovery passes
   * operationId to restrict the tail to that producer's stamped messages.
   */
  getLatestSpineMessageId = async ({
    operationId,
    topicId,
    threadId,
  }: {
    operationId?: string;
    threadId?: string | null;
    topicId: string;
  }): Promise<string | undefined> => {
    const [row] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.topicId, topicId),
          operationId
            ? sql`${messages.metadata} @> ${JSON.stringify({ operationId })}::jsonb`
            : undefined,
          not(eq(messages.role, 'tool')),
          threadId ? eq(messages.threadId, threadId) : isNull(messages.threadId),
          // Exclude signal-tagged assistants — BUT only the toolless ones. The
          // writer tags a turn `signal` at stream_start before it knows the turn
          // will call tools; a signal turn that DOES emit a tool_use is really
          // back on the main chain (see `reduceToolsChunk`'s spine promotion),
          // so it must stay a spine candidate or a cold replica re-forks the
          // wire off the pre-signal turn. Match the read side, which likewise
          // treats a tools-bearing message as non-signal (`getMessageSignal`).
          //
          // Key existence (`jsonb_exists`) is used instead of `metadata -> 'signal'
          // IS NULL`, which crashes the serverless Postgres engine as a WHERE
          // predicate (rt_fetch out-of-bounds, SQLSTATE XX000 — the `->` operator
          // only survives in SELECT/ORDER BY). Toolless is expressed with plain
          // jsonb equality (`= '[]'` / IS NULL) rather than `jsonb_array_length`,
          // which is unproven on this engine as a qual.
          sql`NOT (
            COALESCE(jsonb_exists(${messages.metadata}, 'signal'), false)
            AND (${messages.tools} IS NULL OR ${messages.tools} = '[]'::jsonb)
          )`,
          this.ownership(),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    return row?.id;
  };

  /**
   * Fallback anchor for {@link getLatestSpineMessageId}: the latest non-tool
   * message in a topic/thread, WITHOUT the toolless-signal exclusion.
   *
   * A topic whose main thread holds nothing but toolless signal turns has no
   * spine candidate, so the spine lookup returns undefined and the caller would
   * persist the new turn with `parentId: undefined` — a second root that forks
   * the conversation tree. The renderer walks that forest depth-first, so an
   * earlier root's long-running subtree gets emitted before a later root and the
   * newest reply surfaces ABOVE older messages.
   *
   * `role:'tool'` stays excluded: tool results are inline children of their
   * assistant turn, and anchoring a normal turn onto one orphans it under the
   * read side's tool-only signal collection.
   */
  getLatestNonToolMessageId = async ({
    topicId,
    threadId,
  }: {
    threadId?: string | null;
    topicId: string;
  }): Promise<string | undefined> => {
    const [row] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.topicId, topicId),
          not(eq(messages.role, 'tool')),
          threadId ? eq(messages.threadId, threadId) : isNull(messages.threadId),
          this.ownership(),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);

    return row?.id;
  };
}

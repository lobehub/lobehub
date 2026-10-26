import type { MessageMetadata, MessagePluginItem } from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import { clampToolIdentifier } from '@/utils/clampToolIdentifier';

import { messagePlugins, messages } from '../../schemas';
import { notShareVisitorMessage } from '../../utils/shareVisitor';
import type { MessageLookupQueries } from './lookup';
import type { MessageScopeArgs } from './scope';
import { MessageScope } from './scope';

export class HumanApprovalAlreadyResolvedError extends Error {
  constructor(messageId: string) {
    super(`Human approval is no longer pending for tool message ${messageId}`);
    this.name = 'HumanApprovalAlreadyResolvedError';
  }
}

export class MessagePluginStore extends MessageScope {
  private readonly lookups: MessageLookupQueries;

  constructor(args: MessageScopeArgs, deps: { lookups: MessageLookupQueries }) {
    super(...args);
    this.lookups = deps.lookups;
  }

  updatePluginState = async (id: string, state: Record<string, any>): Promise<void> => {
    const updated = await this.db
      .update(messagePlugins)
      .set({
        // Plugin-state patches own complete top-level keys. Merge them in SQL so
        // concurrent writers of different keys cannot overwrite each other.
        state: sql`coalesce(${messagePlugins.state}, '{}'::jsonb) || ${JSON.stringify(state)}::jsonb`,
      })
      .where(and(eq(messagePlugins.id, id), this.pluginsOwnership()))
      .returning({ id: messagePlugins.id });

    if (updated.length === 0) throw new Error('Plugin not found');
  };

  updateMessagePlugin = async (id: string, value: Partial<MessagePluginItem>) => {
    const item = await this.db.query.messagePlugins.findFirst({
      where: and(eq(messagePlugins.id, id), this.pluginsOwnership()),
    });
    if (!item) throw new Error('Plugin not found');

    return this.db
      .update(messagePlugins)
      .set({
        ...value,
        apiName: clampToolIdentifier(value.apiName),
        identifier: clampToolIdentifier(value.identifier),
      })
      .where(and(eq(messagePlugins.id, id), this.pluginsOwnership()));
  };

  /**
   * Row-lock the plugin rows of an approval batch (`SELECT … FOR UPDATE`).
   * Only meaningful on a transaction-bound store: the approval repository
   * (`MessageApprovalRepo`) calls it after locking the message rows, matching
   * deferred completion's lock order (message before plugin).
   */
  lockApprovalPluginsForUpdate = async (ids: string[]) =>
    this.db
      .select({
        id: messagePlugins.id,
        intervention: messagePlugins.intervention,
        state: messagePlugins.state,
      })
      .from(messagePlugins)
      .where(and(inArray(messagePlugins.id, ids), this.pluginsOwnership()))
      .for('update');

  /**
   * Write the approval columns (intervention / error / state) of one plugin
   * row. Returns `false` when the row is outside this scope.
   */
  patchApprovalPlugin = async (
    id: string,
    value: Pick<Partial<typeof messagePlugins.$inferInsert>, 'error' | 'intervention' | 'state'>,
  ): Promise<boolean> => {
    const [updated] = await this.db
      .update(messagePlugins)
      .set(value)
      .where(and(eq(messagePlugins.id, id), this.pluginsOwnership()))
      .returning({ id: messagePlugins.id });
    return Boolean(updated);
  };

  /**
   * Fetch the `message_plugins` row associated with a tool message. Tool-call
   * metadata (identifier / apiName / arguments / type / toolCallId /
   * intervention) lives on this row, not on the `messages` row returned by
   * {@link findById}.
   *
   * Returns `undefined` when the message has no plugin row. Normalizes the
   * DB row (nullable columns) into the optional-field shape of
   * {@link MessagePluginItem} so callers don't need to juggle `null` vs
   * `undefined`.
   */
  findMessagePlugin = async (messageId: string): Promise<MessagePluginItem | undefined> => {
    const row = await this.db.query.messagePlugins.findFirst({
      where: and(eq(messagePlugins.id, messageId), this.pluginsOwnership()),
    });
    if (!row) return undefined;
    return {
      apiName: row.apiName ?? undefined,
      arguments: row.arguments ?? undefined,
      clientId: row.clientId ?? undefined,
      error: row.error ?? undefined,
      id: row.id,
      identifier: row.identifier ?? undefined,
      intervention: row.intervention ?? undefined,
      state: row.state ?? undefined,
      toolCallId: row.toolCallId ?? undefined,
      type: row.type ?? 'default',
      userId: row.userId,
    };
  };

  /**
   * List tool/plugin rows for a topic in stable first-seen order.
   *
   * This is used by onboarding analytics to reconstruct successful assistant
   * creation results before the topic is moved into inbox.
   */
  listMessagePluginsByTopic = async (
    topicId: string,
  ): Promise<Array<MessagePluginItem & { metadata?: MessageMetadata }>> => {
    const rows = await this.db
      .select({
        apiName: messagePlugins.apiName,
        arguments: messagePlugins.arguments,
        clientId: messagePlugins.clientId,
        error: messagePlugins.error,
        id: messagePlugins.id,
        identifier: messagePlugins.identifier,
        intervention: messagePlugins.intervention,
        metadata: messages.metadata,
        state: messagePlugins.state,
        toolCallId: messagePlugins.toolCallId,
        type: messagePlugins.type,
        userId: messagePlugins.userId,
      })
      .from(messagePlugins)
      .innerJoin(messages, eq(messagePlugins.id, messages.id))
      .where(and(eq(messages.topicId, topicId), this.ownership(), this.pluginsOwnership()))
      .orderBy(asc(messages.createdAt), asc(messages.id));

    return rows.map((row) => ({
      apiName: row.apiName ?? undefined,
      arguments: row.arguments ?? undefined,
      clientId: row.clientId ?? undefined,
      error: row.error ?? undefined,
      id: row.id,
      identifier: row.identifier ?? undefined,
      intervention: row.intervention ?? undefined,
      metadata: row.metadata ?? undefined,
      state: row.state ?? undefined,
      toolCallId: row.toolCallId ?? undefined,
      type: row.type ?? 'default',
      userId: row.userId,
    }));
  };

  /**
   * The newest calls to one tool API across several topics, oldest first, with
   * the tool message's text — where a CLI adapter records the call's result.
   * Lets a later run read what earlier runs of the same Task asked and got
   * back, e.g. the owner's answers to `askUserQuestion`.
   */
  listToolCallsInTopics = async (params: {
    apiName: string;
    limit?: number;
    topicIds: string[];
  }): Promise<
    Array<{ arguments?: string; content?: string; createdAt: Date; topicId: string | null }>
  > => {
    if (params.topicIds.length === 0) return [];

    const rows = await this.db
      .select({
        arguments: messagePlugins.arguments,
        content: messages.content,
        createdAt: messages.createdAt,
        id: messages.id,
        topicId: messages.topicId,
      })
      .from(messagePlugins)
      .innerJoin(messages, eq(messagePlugins.id, messages.id))
      .where(
        and(
          inArray(messages.topicId, params.topicIds),
          eq(messagePlugins.apiName, params.apiName),
          this.ownership(),
          this.pluginsOwnership(),
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(params.limit ?? 20);

    return rows.reverse().map((row) => ({
      arguments: row.arguments ?? undefined,
      content: row.content ?? undefined,
      createdAt: row.createdAt,
      topicId: row.topicId,
    }));
  };

  /**
   * The `state` of the most recent call to one tool API in a topic that
   * produced any — a failed or aborted call leaves no state. Lets a tool read
   * back what an earlier call in the same conversation produced, e.g. the group
   * a builder conversation last created with `createGroup`.
   *
   * Scoped like a message query for the same branch: without `threadId` only
   * the main conversation counts; with it, the thread plus the parent messages
   * its type inherits — never a sibling thread.
   */
  findLatestPluginStateInTopic = async (params: {
    apiName: string;
    identifier: string;
    threadId?: string | null;
    topicId: string;
  }): Promise<Record<string, any> | undefined> => {
    const threadCondition = params.threadId
      ? await this.lookups.buildThreadQueryCondition(params.threadId)
      : isNull(messages.threadId);

    const [row] = await this.db
      .select({ state: messagePlugins.state })
      .from(messagePlugins)
      .innerJoin(messages, eq(messagePlugins.id, messages.id))
      .where(
        and(
          eq(messages.topicId, params.topicId),
          threadCondition,
          eq(messagePlugins.identifier, params.identifier),
          eq(messagePlugins.apiName, params.apiName),
          isNotNull(messagePlugins.state),
          this.ownership(),
          this.pluginsOwnership(),
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(1);

    return row?.state ?? undefined;
  };

  /**
   * List the tool/plugin rows produced by ONE agent operation, for the
   * per-operation file-edit scan.
   *
   * An operation has no direct foreign key on `message_plugins`, so its rows are
   * bracketed two ways, OR-ed together:
   * 1. Time window — same `topicId` + `threadId`, with the owning message's
   *    `createdAt` inside `[startedAt, completedAt]` (`completedAt` falls back to
   *    now for an op still finalizing). The primary path for in-process runs.
   * 2. Heterogeneous match — the message carries
   *    `metadata.heterogeneousToolStateOperationId === operationId` directly,
   *    which a CLI-backed run stamps regardless of when the row lands. Mirrors
   *    the jsonb predicate in {@link findVerifyMessageByOperationId}.
   *
   * TRADE-OFF (v1): the time window is racy — two operations running
   * concurrently in the SAME topic+thread can bleed each other's tool calls into
   * the window. Accepted for now; the heterogeneous path is exact where it
   * applies. Rows carry `createdAt` so the caller can globally order tool calls
   * merged across an operation tree before folding them.
   */
  listMessagePluginsForOperation = async (params: {
    completedAt?: Date | null;
    operationId: string;
    startedAt: Date;
    threadId?: string | null;
    topicId: string;
  }): Promise<Array<MessagePluginItem & { content?: string; createdAt: Date }>> => {
    const completedAt = params.completedAt ?? new Date();

    const withinWindow = and(
      eq(messages.topicId, params.topicId),
      params.threadId ? eq(messages.threadId, params.threadId) : isNull(messages.threadId),
      gte(messages.createdAt, params.startedAt),
      lte(messages.createdAt, completedAt),
    );

    // The two branches are resolved SEPARATELY — never OR-ed into one WHERE (an
    // `... AND (withinWindow OR heteroMatch)` is unindexable and seq-scans every
    // plugin row the user owns). They are also SHAPED differently on purpose:
    //
    // - Time window: one index-friendly range scan joined to its plugin rows.
    // - Heterogeneous match: resolved id-FIRST, not as a plugin JOIN. The
    //   `metadata->>'heterogeneousToolStateOperationId'` predicate carries a 0.5%
    //   default selectivity estimate, so joining it to `message_plugins` makes the
    //   planner scan / nested-loop the user's ENTIRE plugin history (100k+ rows,
    //   100s+ per call for heavy users — it returns ~0 rows but pays the full scan
    //   every time, since most ops never stamp the key). Looking up the few
    //   matching message ids in a JOIN-free query first, then fetching those rows
    //   by primary key, leaves the planner no join to mis-order: the lookup is
    //   single-table (index-served once the metadata expression is indexed; a
    //   bounded scan otherwise) and the fetch is a pure PK access. Kept
    //   topic-agnostic to preserve the prior behaviour exactly — a late CLI row
    //   can land outside the op's window (and, rarely, its topic).
    const projection = {
      apiName: messagePlugins.apiName,
      arguments: messagePlugins.arguments,
      clientId: messagePlugins.clientId,
      // The tool message's text body. Heterogeneous CLI adapters (claude-code
      // Bash) persist the command's stdout here rather than in a structured
      // `state` field, and the completion-time github Work scan reads the gh
      // CLI's printed entity URL from it.
      content: messages.content,
      createdAt: messages.createdAt,
      error: messagePlugins.error,
      id: messagePlugins.id,
      identifier: messagePlugins.identifier,
      intervention: messagePlugins.intervention,
      state: messagePlugins.state,
      toolCallId: messagePlugins.toolCallId,
      type: messagePlugins.type,
      userId: messagePlugins.userId,
    };

    const scan = (condition: SQL | undefined) =>
      this.db
        .select(projection)
        .from(messagePlugins)
        .innerJoin(messages, eq(messagePlugins.id, messages.id))
        .where(and(this.ownership(), this.pluginsOwnership(), condition));

    const fetchHeterogeneous = async () => {
      const idRows = await this.db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            this.ownership(),
            sql`${messages.metadata}->>'heterogeneousToolStateOperationId' = ${params.operationId}`,
          ),
        );
      const ids = idRows.map((row) => row.id);
      if (ids.length === 0) return [];
      return scan(inArray(messagePlugins.id, ids));
    };

    const [windowRows, heterogeneousRows] = await Promise.all([
      scan(withinWindow),
      fetchHeterogeneous(),
    ]);

    const byId = new Map<string, (typeof windowRows)[number]>();
    for (const row of windowRows) byId.set(row.id, row);
    for (const row of heterogeneousRows) if (!byId.has(row.id)) byId.set(row.id, row);

    const rows = [...byId.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );

    return rows.map((row) => ({
      apiName: row.apiName ?? undefined,
      arguments: row.arguments ?? undefined,
      clientId: row.clientId ?? undefined,
      content: row.content ?? undefined,
      createdAt: row.createdAt,
      error: row.error ?? undefined,
      id: row.id,
      identifier: row.identifier ?? undefined,
      intervention: row.intervention ?? undefined,
      state: row.state ?? undefined,
      toolCallId: row.toolCallId ?? undefined,
      type: row.type ?? 'default',
      userId: row.userId,
    }));
  };

  /**
   * Load specific tool-call rows by their message ids, ownership-scoped and
   * pinned to one topic. Serves the LOCAL hetero run work scan
   * (`work.registerShellWorksForRun`): a desktop-local CLI run has no
   * `agent_operations` row, so the client reports the exact tool message ids it
   * persisted instead of the server reconstructing an operation window. The
   * topic pin means a caller can never scan rows outside the conversation it
   * claims to complete.
   */
  listMessagePluginsByIds = async (params: {
    ids: string[];
    topicId: string;
  }): Promise<Array<MessagePluginItem & { content?: string; createdAt: Date }>> => {
    if (params.ids.length === 0) return [];

    const rows = await this.db
      .select({
        apiName: messagePlugins.apiName,
        arguments: messagePlugins.arguments,
        clientId: messagePlugins.clientId,
        // The tool message's text body — claude-code Bash persists the
        // command's stdout here (see listMessagePluginsForOperation).
        content: messages.content,
        createdAt: messages.createdAt,
        error: messagePlugins.error,
        id: messagePlugins.id,
        identifier: messagePlugins.identifier,
        intervention: messagePlugins.intervention,
        state: messagePlugins.state,
        toolCallId: messagePlugins.toolCallId,
        type: messagePlugins.type,
        userId: messagePlugins.userId,
      })
      .from(messagePlugins)
      .innerJoin(messages, eq(messagePlugins.id, messages.id))
      .where(
        and(
          inArray(messagePlugins.id, params.ids),
          eq(messages.topicId, params.topicId),
          this.ownership(),
          this.pluginsOwnership(),
          // A desktop-local hetero run never happens inside an agent-share
          // visitor topic, so excluding them costs nothing and stops a creator
          // from surfacing a visitor's tool calls as their own Work cards.
          notShareVisitorMessage(),
        ),
      );

    const sorted = [...rows].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );

    return sorted.map((row) => ({
      apiName: row.apiName ?? undefined,
      arguments: row.arguments ?? undefined,
      clientId: row.clientId ?? undefined,
      content: row.content ?? undefined,
      createdAt: row.createdAt,
      error: row.error ?? undefined,
      id: row.id,
      identifier: row.identifier ?? undefined,
      intervention: row.intervention ?? undefined,
      state: row.state ?? undefined,
      toolCallId: row.toolCallId ?? undefined,
      type: row.type ?? 'default',
      userId: row.userId,
    }));
  };

  /**
   * Resolve the tool result message id for a toolCallId — the stable identifier
   * the model emitted for the call. Lets server-side services push async state
   * onto a tool card when all they hold is the call id recorded at creation
   * time (e.g. the goal loop updating the `createGoal` card via
   * `task.context.origin.toolCallId`).
   */
  findToolMessageIdByToolCallId = async (
    toolCallId: string,
    /**
     * Restrict the match to calls made by one assistant message.
     *
     * `tool_call_id` is provider-supplied and only unique in practice — the
     * column carries a plain index, not a unique constraint. Callers that act
     * on the row (rather than just reading it) should scope the match, or a
     * reused id from another turn resolves to an unrelated historical result.
     */
    parentId?: string,
  ): Promise<string | null> => {
    const rows = parentId
      ? await this.db
          .select({ id: messagePlugins.id })
          .from(messagePlugins)
          .innerJoin(messages, eq(messages.id, messagePlugins.id))
          .where(
            and(
              eq(messagePlugins.toolCallId, toolCallId),
              eq(messages.parentId, parentId),
              this.pluginsOwnership(),
            ),
          )
          .limit(1)
      : await this.db
          .select({ id: messagePlugins.id })
          .from(messagePlugins)
          .where(and(eq(messagePlugins.toolCallId, toolCallId), this.pluginsOwnership()))
          .limit(1);

    return rows[0]?.id ?? null;
  };
}

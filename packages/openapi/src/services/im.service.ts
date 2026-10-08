import type { ChatTopicMetadata } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { PushLiveActivityModel, PushTokenModel } from '@/database/models/pushToken';
import { TopicModel } from '@/database/models/topic';
import { agentOperations, messages, pushTokens, topics } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';
import { AiAgentService } from '@/server/services/aiAgent';

import { BaseService } from '../common/base.service';
import type { ServiceResult } from '../types';
import type {
  ImMessage,
  ImReadRequest,
  ImSendRequest,
  ImSendResult,
  ImSyncQuery,
  ImSyncResult,
  PushTokenRegisterRequest,
} from '../types/im.type';
import { IM_SYNC_MAX_WAIT_MS } from '../types/im.type';

/** How often a long-poll re-reads the conversation while nothing changed. */
const SYNC_POLL_INTERVAL_MS = 1000;
const DEFAULT_HISTORY_LIMIT = 50;
/** The assistant row a run creates before its first word (`LOADING_FLAT`). */
const LOADING_PLACEHOLDER = '...';

/**
 * A run in these states is still producing the reply, so the client shows
 * "typing…" and the reply is withheld until it lands whole. `waiting_for_human`
 * is deliberately absent: the agent stopped and is waiting on the user.
 * `waiting_for_client` is included even though the operation is parked: the
 * parked assistant row is the very row the resumed run finishes *in place*, so
 * publishing it would expose a half-written turn and — worse — advance the
 * cursor past a `created_at` the in-place update keeps, hiding the finished
 * reply from the client forever.
 */
const TYPING_STATUSES = new Set([
  'idle',
  'running',
  'waiting_for_async_tool',
  'waiting_for_client',
]);

type MessageRow = {
  content: string | null;
  createdAt: Date;
  /** Exact `created_at` in epoch microseconds; a JS Date drops the last three digits. */
  createdAtUs: string;
  error: unknown;
  id: string;
  role: string;
};

type LatestRun = { createdAtUs: string; startedAt: Date | null; status: string };

/**
 * What a viewer's read cursor stores: the newest agent message they have seen,
 * plus its own ordering value — the cursor must keep working after that message
 * is deleted, and `readAt` alone (a JS Date) drops the microseconds the
 * comparison needs.
 */
type ReadCursor = { createdAtUs: string; messageId: string; readAt: string };

/**
 * An incremental cursor: `<epoch micros>_<message id>`.
 *
 * `created_at` alone is not unique — one transaction stamps every row it writes
 * with the same microsecond, and a run writes several rows per turn — so a read
 * keyed on the timestamp alone permanently skips the rows tied with it. The id
 * is the tie-breaker; the whole value stays opaque to the client.
 */
type ParsedCursor = { id: string; us: bigint };

/** Epoch microseconds of a timestamp column, exact (as text, it exceeds 2^53). */
const epochUs = (column: AnyPgColumn) =>
  sql<string>`(extract(epoch from ${column}) * 1000000)::bigint::text`;
const fromEpochUs = (us: string) =>
  sql`'epoch'::timestamptz + (${us} || ' microseconds')::interval`;

const parseCursor = (cursor: string): ParsedCursor | undefined => {
  // Message ids contain `_` themselves, so the split is on the FIRST one.
  const separator = cursor.indexOf('_');
  const us = separator === -1 ? cursor : cursor.slice(0, separator);
  if (!/^\d+$/.test(us)) return undefined;
  return { id: separator === -1 ? '' : cursor.slice(separator + 1), us: BigInt(us) };
};

const formatCursor = ({ id, us }: ParsedCursor) => (us === 0n && id === '' ? '0' : `${us}_${id}`);

const compareCursor = (a: ParsedCursor, b: ParsedCursor) => {
  if (a.us !== b.us) return a.us < b.us ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
};

/** A stored read cursor in the shape the sync comparisons already use. */
const asCursor = ({ createdAtUs, messageId }: ReadCursor): ParsedCursor => ({
  id: messageId,
  us: BigInt(createdAtUs),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toImMessage = (row: Omit<MessageRow, 'createdAtUs'>): ImMessage => ({
  content: row.content ?? '',
  createdAt: row.createdAt.toISOString(),
  error: row.error !== null && row.error !== undefined,
  id: row.id,
  role: row.role === 'user' ? 'user' : 'assistant',
});

/**
 * An agent row is a chat bubble only when it says something (or failed).
 * Tool-call-only steps and empty placeholders are the agent's working, not its
 * words. Expressed in SQL as well ({@link visibleRow}) so a `limit` counts
 * bubbles rather than the working rows hidden behind them.
 */
const VISIBLE_BUBBLE = sql`(${messages.error} is not null or (btrim(coalesce(${messages.content}, '')) <> '' and btrim(coalesce(${messages.content}, '')) <> ${LOADING_PLACEHOLDER}))`;

const visibleRow = (): SQL => sql`(${messages.role} = 'user' or ${VISIBLE_BUBBLE})`;

/** JS twin of {@link VISIBLE_BUBBLE}'s agent branch: a row that says something (or failed). */
const isDeliveredAgentRow = (row: { content: string | null; error: unknown }) => {
  if (row.error !== null && row.error !== undefined) return true;
  const content = (row.content ?? '').trim();
  return content !== '' && content !== LOADING_PLACEHOLDER;
};

/**
 * IM channel REST service — the asynchronous, whole-message view of an agent
 * conversation that messaging-style clients (toby) consume.
 *
 * - `send` persists the user's message and starts the agent run in the
 *   background through the same `execAgent` entry the app composer uses
 *   (interactive, `chat` trigger), so the run gets the agent's persona, tools,
 *   memory and the existing completion push recall. It returns as soon as the
 *   message is received.
 * - `sync` is the read side. Agent replies of a run that is still in flight are
 *   withheld, so a client never sees a half-written message; it sees "typing"
 *   instead, and the whole reply once the run settles.
 */
export class ImRestService extends BaseService {
  private readonly topicModel: TopicModel;

  constructor(db: LobeChatDatabase, userId: string | null, workspaceId?: string) {
    super(db, userId, workspaceId);
    this.topicModel = new TopicModel(db, this.userId, workspaceId);
  }

  async send(input: ImSendRequest): ServiceResult<ImSendResult> {
    const permission = await this.resolveOperationPermission(
      'MESSAGE_CREATE',
      input.topicId ? { targetTopicId: input.topicId } : undefined,
    );
    if (!permission.isPermitted) {
      throw this.createAuthorizationError(permission.message || 'No permission to send messages');
    }

    await assertCanUseWorkspaceAgent({
      agentId: input.agentId,
      db: this.db,
      userId: this.userId,
      workspaceId: this.workspaceId,
    });

    if (input.topicId) await this.requireTopic(input.topicId);

    // Idempotent retry: the client minted this id and already got through once.
    const receipt = await this.idempotentReceipt(input.clientMessageId);
    if (receipt) return receipt;

    const aiAgentService = new AiAgentService(this.db, this.userId, {
      workspaceId: this.workspaceId,
    });

    let result: Awaited<ReturnType<typeof aiAgentService.execAgent>>;
    try {
      result = await aiAgentService.execAgent({
        agentId: input.agentId,
        appContext: input.topicId ? { topicId: input.topicId } : undefined,
        clientIds: input.clientMessageId ? { userMessageId: input.clientMessageId } : undefined,
        interactiveStart: true,
        prompt: input.content,
        trigger: RequestTrigger.Chat,
      });
    } catch (error) {
      // Two concurrent first sends can both miss the pre-check above; the loser
      // then collides with the winner on the message primary key. Report the
      // receipt that won instead of failing a request the client will retry.
      const raced = await this.idempotentReceipt(input.clientMessageId);
      if (raced) return raced;
      throw error;
    }

    if (!result.success) {
      const raced = await this.idempotentReceipt(input.clientMessageId);
      if (raced) return raced;
      throw this.createBusinessError(result.error || 'The agent could not take the message');
    }

    const userMessage = result.userMessageId
      ? await this.findOwnMessage(result.userMessageId)
      : undefined;
    if (!userMessage) throw this.createCommonError('The message was not stored');

    return {
      accepted: true,
      operationId: result.operationId,
      topicId: result.topicId,
      userMessage: toImMessage(userMessage),
    };
  }

  async sync(topicId: string, query: ImSyncQuery): ServiceResult<ImSyncResult> {
    await this.requireTopic(topicId);

    const deadline = Date.now() + Math.min(query.waitMs ?? 0, IM_SYNC_MAX_WAIT_MS);

    for (;;) {
      const snapshot = await this.snapshot(topicId, query);
      // Only `state` moves for something the client has not seen: it carries
      // typing, the read receipt, the unread count *and* the newest delivered
      // message. Re-sent rows (the ones parked beyond a withheld reply) leave it
      // untouched, so a long poll keeps waiting instead of busy-looping.
      const changed = snapshot.state !== query.state;
      if (changed || query.state === undefined || Date.now() + SYNC_POLL_INTERVAL_MS > deadline) {
        return snapshot;
      }
      await sleep(SYNC_POLL_INTERVAL_MS);
    }
  }

  async markRead(topicId: string, input: ImReadRequest): ServiceResult<{ unread: number }> {
    await this.requireTopic(topicId);

    const message = await this.findOwnMessage(input.messageId);
    if (!message || message.topicId !== topicId) {
      throw this.createNotFoundError('Message not found in this conversation');
    }
    // The cursor names the newest AGENT message the caller has seen, so only a
    // delivered agent bubble may move it: a later user row or a hidden working
    // row would otherwise mark earlier unread replies as read.
    if (
      message.threadId !== null ||
      message.role !== 'assistant' ||
      !isDeliveredAgentRow(message)
    ) {
      throw this.createValidationError(
        'messageId must be an agent message this conversation has delivered',
      );
    }

    await this.advanceReadCursor(topicId, {
      createdAtUs: message.createdAtUs,
      messageId: message.id,
      readAt: message.createdAt.toISOString(),
    });

    const snapshot = await this.snapshot(topicId, { limit: 1 });
    return { unread: snapshot.unread };
  }

  async registerPushToken(
    deviceId: string,
    input: PushTokenRegisterRequest,
  ): ServiceResult<{
    deviceId: string;
    platform: string;
  }> {
    this.assertPersonalPushScope();

    const row = await new PushTokenModel(this.db, this.userId).upsert({
      appVersion: input.appVersion,
      deviceId,
      expoToken: input.expoToken,
      locale: input.locale,
      platform: input.platform,
    });
    return { deviceId: row.deviceId, platform: row.platform };
  }

  /**
   * Always scoped to the caller's own rows: unlike the public tRPC sign-out
   * endpoint, this route is authenticated, so holding a device's token is not
   * proof of owning it here. `expoToken` only guards against a stale delete —
   * a device that already rotated its token keeps the newer one.
   */
  async unregisterPushToken(deviceId: string, expoToken?: string): ServiceResult<void> {
    this.assertPersonalPushScope();

    // The token predicate belongs *in* the statement: read-then-delete let a
    // stale sign-out validate the old token, lose the race to a concurrent
    // rotation, and then delete the freshly rotated one.
    const retired = await this.db
      .delete(pushTokens)
      .where(
        and(
          eq(pushTokens.userId, this.userId),
          eq(pushTokens.deviceId, deviceId),
          expoToken ? eq(pushTokens.expoToken, expoToken) : undefined,
        ),
      )
      .returning({ id: pushTokens.id });

    // Live Activity tokens go with the registration they belonged to. A stale
    // sign-out that retired nothing must leave the newer device alone.
    if (retired.length > 0 || !expoToken) {
      await new PushLiveActivityModel(this.db, this.userId).unregisterDevice(deviceId);
    }
  }

  // ------------------------------------------------------------------ internals

  /**
   * The receipt for a `clientMessageId` this user already got through, or
   * `undefined` when the id is unused — or was consumed by a send that never got
   * a turn. `execAgent` stores the user row before the assistant placeholder and
   * the operation, so a failure in between leaves the row behind with nothing to
   * wait for; reporting that as an accepted duplicate would leave every retry
   * answering "already received" for a message no run will ever pick up.
   */
  private async idempotentReceipt(clientMessageId?: string): Promise<ImSendResult | undefined> {
    if (!clientMessageId) return undefined;

    const existing = await this.findOwnMessage(clientMessageId);
    if (!existing || existing.role !== 'user') return undefined;
    if (existing.topicId === null) {
      throw this.createConflictError('clientMessageId is already used outside a conversation');
    }
    if (!(await this.turnStarted(existing.topicId, existing.createdAt))) return undefined;

    return {
      accepted: false,
      operationId: null,
      topicId: existing.topicId,
      userMessage: toImMessage(existing),
    };
  }

  /** The reply placeholder or the operation a send's turn lands after the user row. */
  private async turnStarted(topicId: string, since: Date): Promise<boolean> {
    const [reply] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          this.chatRows(topicId, ['assistant']),
          sql`${messages.createdAt} >= ${since.toISOString()}::timestamptz`,
        ),
      )
      .limit(1);
    if (reply) return true;

    const [operation] = await this.db
      .select({ id: agentOperations.id })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.topicId, topicId),
          this.buildWorkspaceWhere(agentOperations),
          sql`${agentOperations.createdAt} >= ${since.toISOString()}::timestamptz`,
        ),
      )
      .limit(1);
    return !!operation;
  }

  private async requireTopic(topicId: string) {
    const topic = await this.topicModel.findById(topicId);
    if (!topic) throw this.createNotFoundError('Conversation not found');
    return topic;
  }

  /**
   * `push_tokens` carries no workspace and a notification is delivered to every
   * token the user owns, so a device registered through a workspace-scoped
   * credential would receive the user's personal and other-workspace
   * conversations. The resource is personal; refuse the credential instead.
   */
  private assertPersonalPushScope() {
    if (this.workspaceId) {
      throw this.createAuthorizationError(
        'Push tokens are personal to the user and cannot be managed with a workspace-scoped credential',
      );
    }
  }

  private async findOwnMessage(id: string) {
    const [row] = await this.db
      .select({ ...this.rowSelect, threadId: messages.threadId, topicId: messages.topicId })
      .from(messages)
      .where(and(eq(messages.id, id), this.buildWorkspaceWhere(messages)))
      .limit(1);
    return row;
  }

  /** The newest top-level run on the conversation — the one the user is waiting on. */
  private async latestRun(topicId: string): Promise<LatestRun | undefined> {
    const [run] = await this.db
      .select({
        createdAtUs: epochUs(agentOperations.createdAt),
        startedAt: agentOperations.startedAt,
        status: agentOperations.status,
      })
      .from(agentOperations)
      .where(
        and(
          eq(agentOperations.topicId, topicId),
          isNull(agentOperations.parentOperationId),
          this.buildWorkspaceWhere(agentOperations),
        ),
      )
      .orderBy(desc(agentOperations.createdAt))
      .limit(1);
    return run;
  }

  /** Main-line chat rows of the conversation (sub-agent / branch threads excluded). */
  private chatRows(topicId: string, roles: string[]) {
    return and(
      eq(messages.topicId, topicId),
      isNull(messages.threadId),
      inArray(messages.role, roles),
      this.buildWorkspaceWhere(messages),
    );
  }

  /** The client does not get any agent row of the in-flight turn yet. */
  private notWithheld(withheldAfter?: bigint): SQL | undefined {
    if (withheldAfter === undefined) return undefined;
    return sql`(${messages.role} = 'user' or ${messages.createdAt} <= ${fromEpochUs(withheldAfter.toString())})`;
  }

  private readonly rowSelect = {
    content: messages.content,
    createdAt: messages.createdAt,
    createdAtUs: epochUs(messages.createdAt),
    error: messages.error,
    id: messages.id,
    role: messages.role,
  };

  private async snapshot(
    topicId: string,
    query: Pick<ImSyncQuery, 'cursor' | 'limit'>,
  ): Promise<ImSyncResult> {
    const run = await this.latestRun(topicId);
    // `execAgent` stores the user turn and the reply placeholder before the run
    // row exists (in queue mode the gap is about a second). A placeholder newer
    // than the latest run is that run starting: the agent already has the
    // message, so it counts as read and typing, and its reply is withheld.
    const starting = await this.startingReply(topicId, run);
    const typing = (!!run && TYPING_STATUSES.has(run.status)) || !!starting;
    const turn = starting
      ? { createdAtUs: starting.createdAtUs, readAt: starting.createdAt }
      : run && {
          createdAtUs: run.createdAtUs,
          readAt: run.startedAt ?? new Date(Number(BigInt(run.createdAtUs) / 1000n)),
        };

    const readUpTo = turn ? await this.readUpTo(topicId, turn) : null;

    // Whole-message rule: while the run is in flight, every agent row after the
    // message it is answering (its placeholder included) is not done yet. Rows
    // up to and including `withheldAfter` are the delivered part of the turn.
    const withheldAfter =
      typing && turn
        ? BigInt(readUpTo?.createdAtUs ?? turn.createdAtUs) - (readUpTo ? 0n : 1n)
        : undefined;

    const delivered = await this.deliveredRows(topicId, query, withheldAfter);
    const cursor = await this.nextCursor(topicId, query.cursor, withheldAfter, delivered);
    const unread = await this.countUnread(topicId, withheldAfter);
    const head = await this.conversationHead(topicId, withheldAfter);

    return {
      cursor,
      messages: delivered.map(toImMessage),
      readUpTo: readUpTo && { messageId: readUpTo.messageId, readAt: readUpTo.readAt },
      // `state` doubles as the long-poll's change token: it must move for every
      // fact the client can observe, including a new message. It is deliberately
      // computed from the conversation, not from this page — a state derived from
      // the caller's own cursor would differ on the very next poll (the page is
      // empty when nothing is new) and make every poll return at once.
      state: [typing ? 'typing' : 'idle', readUpTo?.messageId ?? '-', unread, head ?? '-'].join(
        ':',
      ),
      typing,
      unread,
    };
  }

  /** The newest whole message in the conversation: the long-poll's change signal. */
  private async conversationHead(
    topicId: string,
    withheldAfter?: bigint,
  ): Promise<string | undefined> {
    const [row] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          this.chatRows(topicId, ['user', 'assistant']),
          visibleRow(),
          this.notWithheld(withheldAfter),
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(1);
    return row?.id;
  }

  /** Whole messages newer than the client's cursor, oldest first. */
  private async deliveredRows(
    topicId: string,
    query: Pick<ImSyncQuery, 'cursor' | 'limit'>,
    withheldAfter?: bigint,
  ): Promise<MessageRow[]> {
    const scope = and(
      this.chatRows(topicId, ['user', 'assistant']),
      visibleRow(),
      this.notWithheld(withheldAfter),
    );
    // The visibility filter runs *inside* these queries on purpose: applied
    // afterwards it would count hidden working rows against `limit` and hand a
    // tool-heavy conversation back almost no bubbles.
    const cursor = query.cursor ? parseCursor(query.cursor) : undefined;

    if (cursor) {
      return this.db
        .select(this.rowSelect)
        .from(messages)
        .where(
          and(
            scope,
            sql`(${messages.createdAt}, ${messages.id}) > (${fromEpochUs(cursor.us.toString())}, ${cursor.id})`,
          ),
        )
        .orderBy(asc(messages.createdAt), asc(messages.id));
    }

    const rows = await this.db
      .select(this.rowSelect)
      .from(messages)
      .where(scope)
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(query.limit ?? DEFAULT_HISTORY_LIMIT);

    return rows.reverse();
  }

  /**
   * Where the client resumes. It advances to the newest delivered message, and
   * stops just before the first withheld reply — a reply sitting beyond the
   * cursor is re-sent until it lands (clients dedupe by id), never skipped.
   */
  private async nextCursor(
    topicId: string,
    start: string | undefined,
    withheldAfter: bigint | undefined,
    delivered: MessageRow[],
  ): Promise<string> {
    let cursor = start ? parseCursor(start) : undefined;

    const lastDelivered = delivered.length > 0 ? delivered.at(-1) : undefined;
    if (lastDelivered) {
      const reached = { id: lastDelivered.id, us: BigInt(lastDelivered.createdAtUs) };
      if (!cursor || compareCursor(reached, cursor) > 0) cursor = reached;
    }

    if (withheldAfter !== undefined) {
      const first = await this.firstWithheldRow(topicId, withheldAfter);
      if (first) {
        const boundary = { id: '', us: BigInt(first.createdAtUs) - 1n };
        if (!cursor || compareCursor(cursor, boundary) > 0) cursor = boundary;
      }
    }

    return cursor ? formatCursor(cursor) : '0';
  }

  /** The earliest agent row of the in-flight turn that has not landed yet. */
  private async firstWithheldRow(topicId: string, withheldAfter: bigint) {
    const [row] = await this.db
      .select({ createdAtUs: epochUs(messages.createdAt) })
      .from(messages)
      .where(
        and(
          this.chatRows(topicId, ['assistant']),
          sql`${messages.createdAt} > ${fromEpochUs(withheldAfter.toString())}`,
        ),
      )
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(1);
    return row;
  }

  /** A reply placeholder (`...`) written after the latest run: a run that is starting. */
  private async startingReply(topicId: string, run: LatestRun | undefined) {
    const [row] = await this.db
      .select({ createdAt: messages.createdAt, createdAtUs: epochUs(messages.createdAt) })
      .from(messages)
      .where(
        and(
          this.chatRows(topicId, ['assistant']),
          eq(messages.content, LOADING_PLACEHOLDER),
          isNull(messages.error),
          // A placeholder that never filled in is abandoned, not a run starting.
          sql`${messages.createdAt} > now() - interval '2 minutes'`,
          run ? sql`${messages.createdAt} > ${fromEpochUs(run.createdAtUs)}` : undefined,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(1);
    return row;
  }

  /**
   * The agent has "read" every user message that had arrived when its latest
   * turn started — the turn is the agent picking the conversation up.
   */
  private async readUpTo(topicId: string, turn: { createdAtUs: string; readAt: Date }) {
    const [read] = await this.db
      .select({ createdAtUs: epochUs(messages.createdAt), id: messages.id })
      .from(messages)
      .where(
        and(
          this.chatRows(topicId, ['user']),
          lte(messages.createdAt, fromEpochUs(turn.createdAtUs)),
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(1);

    return read
      ? { createdAtUs: read.createdAtUs, messageId: read.id, readAt: turn.readAt.toISOString() }
      : null;
  }

  /** This viewer's read cursor, so two members of a shared topic don't share one. */
  private async readCursor(topicId: string): Promise<ReadCursor | undefined> {
    const topic = await this.topicModel.findById(topicId);
    const cursor = topic?.metadata?.imReadCursors?.[this.userId];
    // A cursor written before this shape existed carries no ordering value and
    // cannot be compared safely; treat it as unread rather than hiding replies.
    return cursor?.createdAtUs ? cursor : undefined;
  }

  /**
   * Move this viewer's read cursor forward, atomically. The comparison and the
   * write share one `SELECT … FOR UPDATE` on the topic row: with two devices
   * marking B and C, each would otherwise compare against the same old cursor,
   * both look newer, and the later write could move the cursor *backwards*.
   *
   * The cursor carries its own ordering value, so it keeps working after the
   * message it names is deleted, and it is compared in the same
   * `(created_at, id)` order as sync — two replies of one microsecond would
   * otherwise both count as read once the earlier one is marked.
   */
  private async advanceReadCursor(topicId: string, next: ReadCursor) {
    await this.db.transaction(async (tx) => {
      const [topic] = await tx
        .select({ metadata: topics.metadata })
        .from(topics)
        .where(and(eq(topics.id, topicId), this.buildWorkspaceWhere(topics)))
        .for('update');
      if (!topic) return;

      const current = topic.metadata?.imReadCursors?.[this.userId];
      // Read cursors only move forward: a stale device must not resurrect unread.
      if (current?.createdAtUs && compareCursor(asCursor(current), asCursor(next)) >= 0) return;

      await tx
        .update(topics)
        .set({
          metadata: {
            ...topic.metadata,
            imReadCursors: { ...topic.metadata?.imReadCursors, [this.userId]: next },
          } as ChatTopicMetadata,
        })
        .where(and(eq(topics.id, topicId), this.buildWorkspaceWhere(topics)));
    });
  }

  private async countUnread(topicId: string, withheldAfter?: bigint): Promise<number> {
    const readFrom = await this.readCursor(topicId);

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          this.chatRows(topicId, ['assistant']),
          VISIBLE_BUBBLE,
          this.notWithheld(withheldAfter),
          // Same order as sync's incremental read, and independent of the cursor's
          // own row still existing.
          readFrom
            ? sql`(${messages.createdAt}, ${messages.id}) > (${fromEpochUs(readFrom.createdAtUs)}, ${readFrom.messageId})`
            : undefined,
        ),
      );

    return row?.count ?? 0;
  }
}

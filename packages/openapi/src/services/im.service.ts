import { RequestTrigger } from '@lobechat/types';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { deletePushTokenByExpoTokenAndDevice, PushTokenModel } from '@/database/models/pushToken';
import { TopicModel } from '@/database/models/topic';
import { agentOperations, messages } from '@/database/schemas';
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
 */
const TYPING_STATUSES = new Set(['idle', 'running', 'waiting_for_async_tool']);

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

/** Epoch microseconds of a timestamp column, exact (as text, it exceeds 2^53). */
const epochUs = (column: AnyPgColumn) =>
  sql<string>`(extract(epoch from ${column}) * 1000000)::bigint::text`;
const fromEpochUs = (us: string) =>
  sql`'epoch'::timestamptz + (${us} || ' microseconds')::interval`;

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
 * words.
 */
const isVisible = (row: Omit<MessageRow, 'createdAtUs'>) => {
  if (row.role === 'user') return true;
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
    if (input.clientMessageId) {
      const existing = await this.findOwnMessage(input.clientMessageId);
      if (existing) {
        if (existing.topicId === null) {
          throw this.createConflictError('clientMessageId is already used outside a conversation');
        }
        return {
          accepted: false,
          operationId: null,
          topicId: existing.topicId,
          userMessage: toImMessage(existing),
        };
      }
    }

    const aiAgentService = new AiAgentService(this.db, this.userId, {
      workspaceId: this.workspaceId,
    });
    const result = await aiAgentService.execAgent({
      agentId: input.agentId,
      appContext: input.topicId ? { topicId: input.topicId } : undefined,
      clientIds: input.clientMessageId ? { userMessageId: input.clientMessageId } : undefined,
      interactiveStart: true,
      prompt: input.content,
      trigger: RequestTrigger.Chat,
    });

    if (!result.success) {
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
      const changed = snapshot.messages.length > 0 || snapshot.state !== query.state;
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

    const topic = await this.topicModel.findById(topicId);
    const current = topic?.metadata?.imReadCursor;
    // Read cursors only move forward: a stale device must not resurrect unread.
    // Compared in SQL — `created_at` carries microseconds a JS Date drops.
    const [{ isNewer }] = await this.db
      .select({
        isNewer: sql<boolean>`${messages.createdAt} > coalesce((select m2.created_at from messages m2 where m2.id = ${current?.messageId ?? null}), '-infinity'::timestamptz)`,
      })
      .from(messages)
      .where(eq(messages.id, message.id));
    if (isNewer) {
      await this.topicModel.updateMetadata(topicId, {
        imReadCursor: { messageId: message.id, readAt: message.createdAt.toISOString() },
      });
    }

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
    const row = await new PushTokenModel(this.db, this.userId).upsert({
      appVersion: input.appVersion,
      deviceId,
      expoToken: input.expoToken,
      locale: input.locale,
      platform: input.platform,
    });
    return { deviceId: row.deviceId, platform: row.platform };
  }

  async unregisterPushToken(deviceId: string, expoToken?: string): ServiceResult<void> {
    if (expoToken) {
      await deletePushTokenByExpoTokenAndDevice(this.db, { deviceId, expoToken });
      return;
    }
    await new PushTokenModel(this.db, this.userId).unregister(deviceId);
  }

  // ------------------------------------------------------------------ internals

  private async requireTopic(topicId: string) {
    const topic = await this.topicModel.findById(topicId);
    if (!topic) throw this.createNotFoundError('Conversation not found');
    return topic;
  }

  private async findOwnMessage(id: string) {
    return this.db.query.messages.findFirst({
      columns: { content: true, createdAt: true, error: true, id: true, role: true, topicId: true },
      where: and(eq(messages.id, id), this.buildWorkspaceWhere(messages)),
    });
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
    const scope = this.chatRows(topicId, ['user', 'assistant']);

    const rows: MessageRow[] = query.cursor
      ? await this.db
          .select(this.rowSelect)
          .from(messages)
          .where(and(scope, sql`${messages.createdAt} > ${fromEpochUs(query.cursor)}`))
          .orderBy(asc(messages.createdAt))
      : (
          await this.db
            .select(this.rowSelect)
            .from(messages)
            .where(scope)
            .orderBy(desc(messages.createdAt))
            .limit(query.limit ?? DEFAULT_HISTORY_LIMIT)
        ).reverse();

    const readUpTo = turn ? await this.readUpTo(topicId, turn) : null;

    // Whole-message rule: while the run is in flight, every agent row after the
    // message it is answering (its placeholder included) is not done yet.
    const withheldAfter =
      typing && turn
        ? BigInt(readUpTo?.createdAtUs ?? turn.createdAtUs) - (readUpTo ? 0n : 1n)
        : undefined;
    const isWithheld = (row: MessageRow) =>
      withheldAfter !== undefined && row.role !== 'user' && BigInt(row.createdAtUs) > withheldAfter;

    const delivered = rows.filter((row) => !isWithheld(row) && isVisible(row));

    // The cursor stops right before the first withheld reply, or that reply
    // would be skipped once it lands. User rows sent while the agent is typing
    // sit beyond it and are re-sent until then; clients dedupe by id.
    let cursor = query.cursor ?? '0';
    for (const row of rows) {
      if (isWithheld(row)) {
        if (cursor === '0') cursor = String(BigInt(row.createdAtUs) - 1n);
        break;
      }
      cursor = row.createdAtUs;
    }

    const unread = await this.countUnread(topicId, withheldAfter);

    return {
      cursor,
      messages: delivered.map(toImMessage),
      readUpTo: readUpTo && { messageId: readUpTo.messageId, readAt: readUpTo.readAt },
      state: [typing ? 'typing' : 'idle', readUpTo?.messageId ?? '-', unread].join(':'),
      typing,
      unread,
    };
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
      .orderBy(desc(messages.createdAt))
      .limit(1);

    return read
      ? { createdAtUs: read.createdAtUs, messageId: read.id, readAt: turn.readAt.toISOString() }
      : null;
  }

  private async countUnread(topicId: string, withheldAfter: bigint | undefined): Promise<number> {
    const topic = await this.topicModel.findById(topicId);
    const readFrom = topic?.metadata?.imReadCursor?.messageId;

    const rows: MessageRow[] = await this.db
      .select(this.rowSelect)
      .from(messages)
      .where(
        and(
          this.chatRows(topicId, ['assistant']),
          readFrom
            ? sql`${messages.createdAt} > (select m2.created_at from messages m2 where m2.id = ${readFrom})`
            : undefined,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(100);

    return rows.filter(
      (row) =>
        isVisible(row) && !(withheldAfter !== undefined && BigInt(row.createdAtUs) > withheldAfter),
    ).length;
  }
}

import type {
  ChannelAgentExchange,
  ChannelConnectorRequest,
  ChannelContextMessage,
  ChannelExecutionConfig,
  ChannelHistoryMessage,
  ChannelHistoryMessageDetail,
  ChannelHistoryPage,
  ChannelInputManifest,
  ChannelJobStatus,
  ChannelListThreadsParams,
  ChannelMessageVia,
  ChannelReadMessageParams,
  ChannelReadMessagesParams,
  ChannelThreadPage,
  ChannelThreadRunActivity,
  ChannelThreadSummary,
} from '@lobechat/types';
import {
  agentDisplayName,
  channelAgentExchange,
  channelMessageVia,
  connectorRequestText,
  RequestTrigger,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import {
  agentOperations,
  agents,
  channelJobs,
  channelMembers,
  channelMessages,
  channelThreads,
  messages,
  users,
  workspaceMembers,
} from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { agentTitleSql } from '../../utils/inboxAgent';
import { notTrashed } from '../../utils/softDelete';
import { normalizeWorkspaceId } from '../../utils/workspace';
import { activeMembers, appendMessage, findThread } from './delivery';
import { ChannelError } from './error';
import { readManifestMessages } from './manifest';
import { channelUserNameSql } from './nickname';
import { audit, withChannelLock } from './transaction';
import { OPEN_JOB_STATUSES } from './writer';

const EXCERPT_LENGTH = 2000;
/** A Thread summary is an overview; the Thread itself is read with `readMessages`. */
const SUMMARY_LENGTH = 300;
/** Latest steps of a running reply shown in a Thread summary. */
const ACTIVITY_STEPS = 3;

/** Runs the requester started themselves, which may message for them without a Channel job. */
const DIRECT_RUN_TRIGGERS = new Set<RequestTrigger>([
  RequestTrigger.Bot,
  RequestTrigger.Chat,
  RequestTrigger.Scheduled,
]);

const clip = (text: string | null | undefined, length = SUMMARY_LENGTH) => {
  const value = (text ?? '').trim();
  return value.length > length ? `${value.slice(0, length)}…` : value;
};

/** `identifier.apiName` of each tool call a stored assistant step made. */
const toolNames = (tools: unknown): string[] | undefined => {
  if (!Array.isArray(tools) || !tools.length) return;
  return tools.map((tool) =>
    tool && typeof tool === 'object'
      ? [(tool as Record<string, unknown>).identifier, (tool as Record<string, unknown>).apiName]
          .filter((part) => typeof part === 'string' && part)
          .join('.')
      : 'tool',
  );
};

/** One of the calling Agent's replies in a Thread, with what acting on it needs. */
export interface ChannelThreadJob {
  executionConfig: ChannelExecutionConfig | null;
  id: string;
  operationId: string | null;
  operationStatus: string | null;
  /** The run's owner; only the requester's own run can be steered. */
  operationUserId: string | null;
  status: ChannelJobStatus;
  topicId: string | null;
}

/** Another Thread of the run's Channel, as the run sees it before acting on it. */
export interface ChannelThreadTarget {
  channelId: string;
  /** The calling Agent's queued or running replies there, newest first. */
  openJobs: ChannelThreadJob[];
  /** The request the run answers was itself relayed by an Agent (a Thread an Agent opened). */
  relayed: boolean;
  self: ChannelInputManifest['self'];
  threadId: string;
}
const DETAIL_LENGTH = 12_000;

const excerpt = (
  message: ChannelContextMessage,
  offset: number,
  length: number,
): ChannelHistoryMessage => ({
  ...message,
  content: message.content.slice(offset, offset + length),
  contentLength: message.content.length,
  truncated: offset + length < message.content.length,
});

const integer = (value: number | undefined, fallback: number, min: number, max: number) => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw new ChannelError('BAD_REQUEST', `Expected an integer between ${min} and ${max}`);
  return result;
};

/** Public history only. Every read re-authorizes the live operation under the Channel lock. */
export class ChannelHistoryRepository {
  private readonly workspaceId: string | null;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    workspaceId?: string | null,
  ) {
    this.workspaceId = normalizeWorkspaceId(workspaceId);
  }

  private async read<T>(
    operationId: string,
    fn: (tx: Transaction, channelId: string, manifest: ChannelInputManifest) => Promise<T>,
    /**
     * Whether another person's shared Agent may use this read. Only plain history reads opt in:
     * the run executes as the owner, so anything acting from it (listing or posting into
     * Channels) would act in the owner's Channels.
     */
    { allowShared = false }: { allowShared?: boolean } = {},
  ): Promise<T> {
    // This lookup reveals nothing to the caller; authorization is repeated after taking the lock.
    const [reference] = await this.db
      .select({ channelId: channelJobs.channelId })
      .from(channelJobs)
      .where(eq(channelJobs.operationId, operationId))
      .limit(1);
    if (!reference) throw new ChannelError('NOT_FOUND', 'Channel operation not found');

    return withChannelLock(this.db, reference.channelId, async (tx, channel) => {
      const [row] = await tx
        .select({ job: channelJobs, operation: agentOperations })
        .from(channelJobs)
        .innerJoin(agentOperations, eq(agentOperations.id, channelJobs.operationId))
        .where(and(eq(channelJobs.operationId, operationId), eq(channelJobs.channelId, channel.id)))
        .limit(1);
      // A shared Agent runs as its owner in its own scope for the person of a direct
      // conversation, personal or in that person's workspace (`executionConfig.share`, frozen at
      // claim): the operation is the owner's, the Channel and its requester are that person's.
      const share = row?.job.executionConfig?.share;
      const requesterId = share ? channel.userId : this.userId;
      if (
        !row ||
        row.operation.userId !== this.userId ||
        row.operation.workspaceId !== this.workspaceId ||
        (share
          ? share.ownerId !== this.userId ||
            share.workspaceId !== this.workspaceId ||
            channel.agentId !== row.job.manifest?.self.agentId ||
            !requesterId
          : channel.workspaceId !== this.workspaceId ||
            (channel.agentId && channel.userId !== this.userId))
      )
        throw new ChannelError('NOT_FOUND', 'Channel operation not found');
      if (share && !allowShared)
        throw new ChannelError('FORBIDDEN', 'A shared Agent can only read its own conversation');
      const { job, operation } = row;
      if (
        channel.isDeleted ||
        channel.status === 'archived' ||
        !job.manifest ||
        job.publicationRevoked ||
        job.status !== 'running' ||
        operation.status !== 'running' ||
        operation.topicId !== job.topicId
      )
        throw new ChannelError('CONFLICT', 'Channel operation is no longer active');

      const members = await activeMembers(tx, channel.id, [job.memberId, job.requesterMemberId]);
      const requester = members.find((member) => member.id === job.requesterMemberId);
      const agent = members.find((member) => member.id === job.memberId);
      if (
        requester?.actorType !== 'user' ||
        requester.userId !== requesterId ||
        agent?.actorType !== 'agent' ||
        agent.agentId !== job.manifest.self.agentId
      )
        throw new ChannelError('FORBIDDEN', 'Channel membership changed');
      if (this.workspaceId) {
        const [membership] = await tx
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, this.workspaceId),
              eq(workspaceMembers.userId, this.userId),
              isNull(workspaceMembers.deletedAt),
            ),
          )
          .limit(1);
        if (!membership)
          throw new ChannelError('FORBIDDEN', 'Workspace membership is no longer active');
      }
      // The job's branch is the live one: gathering an already dispatched peer into a Thread moves
      // `job.threadId` while the frozen input keeps the branch it was claimed in, and everything
      // this read feeds — history scope, relay and callback origins — belongs to where the run is
      // now. The frozen input still owns the cutoff and the request it answers.
      const thread = await findThread(tx, channel.id, job.threadId);
      // An archived branch leaves Agent context even for a run that already started in it.
      if (thread?.status === 'archived')
        throw new ChannelError('CONFLICT', 'Channel operation is no longer active');
      const manifest: ChannelInputManifest =
        job.threadId === job.manifest.threadId
          ? job.manifest
          : {
              ...job.manifest,
              threadId: job.threadId,
              threadRootSequence: thread?.rootSequence ?? null,
            };
      return fn(tx, channel.id, manifest);
    });
  }

  /**
   * The live run's Channel and request, under the same checks as a history read: what a run may
   * act from (e.g. relay a request into another Channel). `requestVia` is set when the request
   * it answers was itself relayed by an Agent, and `requestByAgent` when another Agent wrote it
   * in their conversation: either way the run answers instead of passing it on. `exchange` is set
   * when, in that conversation, it answers the other Agent's answer to what it asked.
   */
  currentRun = async (
    operationId: string,
  ): Promise<{
    channelId: string;
    exchange?: ChannelAgentExchange;
    manifest: ChannelInputManifest;
    requestByAgent?: boolean;
    requestVia?: ChannelMessageVia;
  }> =>
    this.read(operationId, async (tx, channelId, manifest) => {
      const message = (id: string) =>
        tx
          .select({
            agentId: channelMessages.agentId,
            metadata: channelMessages.metadata,
            replyToId: channelMessages.replyToId,
            routingStatus: channelMessages.routingStatus,
          })
          .from(channelMessages)
          .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.id, id)))
          .limit(1)
          .then(([row]) => row);
      const request = await message(manifest.requestMessageId);
      if (request?.routingStatus !== 'reply' || !request.replyToId)
        return {
          channelId,
          manifest,
          ...(request?.agentId && { requestByAgent: true }),
          requestVia: channelMessageVia(request?.metadata),
        };

      // Woken by an answer: the request it answered names where the exchange began.
      const asked = await message(request.replyToId);
      const exchange = channelAgentExchange(asked?.metadata);
      return { channelId, ...(exchange && { exchange }), manifest };
    });

  /**
   * Who a run relays as, and from where. A Channel run relays from its Channel and request
   * (`currentRun`, all its checks). A run with no Channel job may only be the requester's own
   * live direct run, and only when the caller says so (`allowDirectRun`): the requester asked
   * their Agent, in a chat (sent or scheduled) or as the bot's owner on an IM platform, to message
   * someone or post into one of their Channels. Only a caller holding that run's `channel:message`
   * token, minted only for those runs, may set it; the trigger is checked again here so no
   * server-started run without a Channel can relay.
   */
  relaySource = async (
    operationId: string,
    { allowDirectRun = false }: { allowDirectRun?: boolean } = {},
  ): Promise<{
    /** The Channel run, with what {@link currentRun} reads; absent for a direct run. */
    channelRun?: Awaited<ReturnType<ChannelHistoryRepository['currentRun']>>;
    origin?: { channelId: string; threadId: string | null };
    requestVia?: ChannelMessageVia;
    self: { agentId: string; name: string };
  }> => {
    const [job] = await this.db
      .select({ id: channelJobs.id })
      .from(channelJobs)
      .where(eq(channelJobs.operationId, operationId))
      .limit(1);
    if (job || !allowDirectRun) {
      const run = await this.currentRun(operationId);
      return {
        channelRun: run,
        origin: { channelId: run.channelId, threadId: run.manifest.threadId },
        requestVia: run.requestVia,
        self: { agentId: run.manifest.self.agentId, name: run.manifest.self.name },
      };
    }

    const [operation] = await this.db
      .select({
        agentId: agentOperations.agentId,
        agentName: agents.name,
        agentTitle: agentTitleSql(),
        status: agentOperations.status,
        trigger: agentOperations.trigger,
        userId: agentOperations.userId,
        workspaceId: agentOperations.workspaceId,
      })
      .from(agentOperations)
      .leftJoin(agents, eq(agents.id, agentOperations.agentId))
      .where(eq(agentOperations.id, operationId))
      .limit(1);
    if (
      !operation?.agentId ||
      operation.userId !== this.userId ||
      operation.workspaceId !== this.workspaceId ||
      !DIRECT_RUN_TRIGGERS.has(operation.trigger as RequestTrigger)
    )
      throw new ChannelError('NOT_FOUND', 'Channel operation not found');
    if (operation.status !== 'running')
      throw new ChannelError('CONFLICT', 'Channel operation is no longer active');
    return {
      self: {
        agentId: operation.agentId,
        name: agentDisplayName({ name: operation.agentName, title: operation.agentTitle }, 'Agent'),
      },
    };
  };

  /**
   * Threads of the run's Channel, newest first, with the calling Agent's latest reply in each.
   * A running reply the requester owns also shows its latest steps, read from its conversation.
   */
  listThreads = async (
    operationId: string,
    params: ChannelListThreadsParams = {},
  ): Promise<ChannelThreadPage> => {
    const limit = integer(params.limit, 10, 1, 20);
    return this.read(operationId, async (tx, channelId, manifest) => {
      // The cursor is a threadId, so a caller pages by `nextBefore` without holding a snapshot.
      // The comparison stays in SQL against the stored row: Postgres keeps microseconds while a
      // JS `Date` stops at milliseconds, so reading the timestamp out and binding it back would
      // round the cursor down and skip the Threads that share its millisecond. `createdAt` alone
      // is not unique either (a bulk open writes several Threads at once), hence the id tie-break.
      let cursorScope: SQL | undefined;
      if (params.before) {
        const [row] = await tx
          .select({ id: channelThreads.id })
          .from(channelThreads)
          .where(and(eq(channelThreads.channelId, channelId), eq(channelThreads.id, params.before)))
          .limit(1);
        if (!row) throw new ChannelError('BAD_REQUEST', 'before must be a Thread of this Channel');
        cursorScope = sql`(
          SELECT ${channelThreads.createdAt}, ${channelThreads.id}
          FROM ${channelThreads}
          WHERE ${channelThreads.id} = ${row.id}
        )`;
      }

      const selfJobs = params.activeOnly
        ? await tx
            .selectDistinct({ threadId: channelJobs.threadId })
            .from(channelJobs)
            .where(
              and(
                eq(channelJobs.channelId, channelId),
                eq(channelJobs.memberId, manifest.self.memberId),
                inArray(channelJobs.status, OPEN_JOB_STATUSES),
              ),
            )
        : undefined;
      const activeIds = selfJobs?.map((job) => job.threadId).filter((id): id is string => !!id);
      if (activeIds && !activeIds.length) return { hasMore: false, nextBefore: null, threads: [] };

      const rows = await tx
        .select({ root: channelMessages.content, thread: channelThreads })
        .from(channelThreads)
        .innerJoin(
          channelMessages,
          and(
            eq(channelMessages.channelId, channelThreads.channelId),
            eq(channelMessages.id, channelThreads.rootMessageId),
          ),
        )
        .where(
          and(
            eq(channelThreads.channelId, channelId),
            notTrashed(channelThreads.isDeleted),
            activeIds ? inArray(channelThreads.id, activeIds) : undefined,
            cursorScope
              ? sql`(${channelThreads.createdAt}, ${channelThreads.id}) < ${cursorScope}`
              : undefined,
          ),
        )
        .orderBy(desc(channelThreads.createdAt), desc(channelThreads.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const nextBefore = rows.length > limit ? (page.at(-1)?.thread.id ?? null) : null;

      const threads: ChannelThreadSummary[] = [];
      for (const { root, thread } of page) {
        const [counted] = await tx
          .select({ value: count() })
          .from(channelMessages)
          .where(
            and(eq(channelMessages.channelId, channelId), eq(channelMessages.threadId, thread.id)),
          );
        const [last] = await readManifestMessages(
          tx,
          channelId,
          liveThreadManifest(manifest, thread),
          { limit: 1 },
        );
        threads.push({
          current: manifest.threadId === thread.id,
          lastMessage:
            last && last.threadId === thread.id
              ? { author: last.author.name, content: clip(last.content) }
              : null,
          messageCount: counted?.value ?? 0,
          root: clip(root),
          run: await this.latestRun(tx, channelId, manifest, thread.id),
          status: thread.status,
          threadId: thread.id,
        });
      }
      return { hasMore: rows.length > limit, nextBefore, threads };
    });
  };

  private latestRun = async (
    tx: Transaction,
    channelId: string,
    manifest: ChannelInputManifest,
    threadId: string,
  ): Promise<ChannelThreadSummary['run']> => {
    const [row] = await tx
      .select({
        createdAt: channelJobs.createdAt,
        operation: {
          createdAt: agentOperations.createdAt,
          status: agentOperations.status,
          stepCount: agentOperations.stepCount,
          topicId: agentOperations.topicId,
          userId: agentOperations.userId,
        },
        request: channelMessages.content,
        requesterName: channelMembers.name,
        requesterFullName: channelUserNameSql(channelMembers.channelId, channelMembers.userId),
        requesterMemberId: channelJobs.requesterMemberId,
        status: channelJobs.status,
      })
      .from(channelJobs)
      .leftJoin(agentOperations, eq(agentOperations.id, channelJobs.operationId))
      .leftJoin(
        channelMessages,
        and(
          eq(channelMessages.channelId, channelJobs.channelId),
          eq(channelMessages.id, channelJobs.messageId),
        ),
      )
      .leftJoin(channelMembers, eq(channelMembers.id, channelJobs.requesterMemberId))
      .leftJoin(users, eq(users.id, channelMembers.userId))
      .where(
        and(
          eq(channelJobs.channelId, channelId),
          eq(channelJobs.memberId, manifest.self.memberId),
          eq(channelJobs.threadId, threadId),
        ),
      )
      .orderBy(desc(channelJobs.createdAt))
      .limit(1);
    if (!row) return null;

    const operation = row.operation?.createdAt ? row.operation : null;
    // Only the requester's own run: another person's conversation is theirs to read.
    const activity =
      row.status === 'running' && operation?.topicId && operation.userId === this.userId
        ? await this.runActivity(tx, operation.topicId, operation.createdAt)
        : undefined;
    return {
      ...(activity?.length && { activity }),
      createdAt: row.createdAt.toISOString(),
      request: clip(row.request),
      requester:
        row.requesterMemberId === manifest.requesterMemberId
          ? 'your requester'
          : row.requesterFullName || row.requesterName || 'a member',
      status: row.status,
      stepCount: operation?.stepCount ?? null,
    };
  };

  private runActivity = async (
    tx: Transaction,
    topicId: string,
    since: Date,
  ): Promise<ChannelThreadRunActivity[]> => {
    const steps = await tx
      .select({
        content: messages.content,
        createdAt: messages.createdAt,
        role: messages.role,
        tools: messages.tools,
      })
      .from(messages)
      .where(
        and(
          eq(messages.topicId, topicId),
          eq(messages.userId, this.userId),
          gte(messages.createdAt, since),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(ACTIVITY_STEPS);
    return steps.reverse().map((step) => {
      const text = clip(step.content, 200);
      const tools = step.role === 'assistant' ? toolNames(step.tools) : undefined;
      return {
        at: step.createdAt.toISOString(),
        role: step.role,
        ...(text && { text }),
        ...(tools && { tools }),
      };
    });
  };

  /**
   * Another Thread of the run's Channel, with the calling Agent's open replies there: what
   * stopping or steering it acts on. The run's own conversation is not a target.
   */
  threadTarget = async (operationId: string, threadId: string): Promise<ChannelThreadTarget> => {
    if (!threadId?.trim()) throw new ChannelError('BAD_REQUEST', 'threadId is required');
    return this.read(operationId, async (tx, channelId, manifest) => {
      const thread = await findThread(tx, channelId, threadId);
      if (!thread) throw new ChannelError('NOT_FOUND', 'Thread not found');
      if (manifest.threadId === thread.id)
        throw new ChannelError(
          'BAD_REQUEST',
          'That is the conversation you are answering in; act on it in your answer',
        );
      const request = await tx
        .select({ metadata: channelMessages.metadata })
        .from(channelMessages)
        .where(
          and(
            eq(channelMessages.channelId, channelId),
            eq(channelMessages.id, manifest.requestMessageId),
          ),
        )
        .limit(1)
        .then(([row]) => row);
      const openJobs = await tx
        .select({
          executionConfig: channelJobs.executionConfig,
          id: channelJobs.id,
          operationId: channelJobs.operationId,
          operationStatus: agentOperations.status,
          operationUserId: agentOperations.userId,
          status: channelJobs.status,
          topicId: channelJobs.topicId,
        })
        .from(channelJobs)
        .leftJoin(agentOperations, eq(agentOperations.id, channelJobs.operationId))
        .where(
          and(
            eq(channelJobs.channelId, channelId),
            eq(channelJobs.memberId, manifest.self.memberId),
            eq(channelJobs.threadId, thread.id),
            inArray(channelJobs.status, OPEN_JOB_STATUSES),
          ),
        )
        .orderBy(desc(channelJobs.createdAt));
      return {
        channelId,
        openJobs,
        relayed: !!channelMessageVia(request?.metadata),
        self: manifest.self,
        threadId: thread.id,
      };
    });
  };

  /**
   * Posts the live run's card asking its requester to connect a connector, in the conversation
   * the run is in (its Thread, or the main timeline). Stored like a reply that answers no request,
   * so it wakes no one and the run's own reply still lands after it. `requestKey` makes a retried
   * call return the card it already posted. A shared Agent runs as its owner, whose connectors the
   * visitor cannot connect, so it cannot ask.
   */
  postConnectorRequest = async (
    operationId: string,
    request: Omit<ChannelConnectorRequest, 'agentId'>,
    requestKey: string,
  ) =>
    this.read(operationId, async (tx, channelId, manifest) => {
      const [existing] = await tx
        .select()
        .from(channelMessages)
        .where(
          and(eq(channelMessages.channelId, channelId), eq(channelMessages.requestKey, requestKey)),
        )
        .limit(1);
      if (existing) return existing;

      const connector: ChannelConnectorRequest = { ...request, agentId: manifest.self.agentId };
      const message = await appendMessage(tx, {
        agentId: manifest.self.agentId,
        channelId,
        content: connectorRequestText(connector),
        metadata: { connector },
        requestKey,
        routingStatus: 'reply',
        threadId: manifest.threadId,
      });
      await audit(tx, channelId, 'agent_posted', manifest.self.memberId, { messageId: message.id });
      return message;
    });

  readMessages = async (
    operationId: string,
    params: ChannelReadMessagesParams = {},
  ): Promise<ChannelHistoryPage> => {
    const limit = integer(params.limit, 10, 1, 20);
    const beforeSequence =
      params.beforeSequence === undefined
        ? undefined
        : integer(params.beforeSequence, 1, 1, Number.MAX_SAFE_INTEGER);
    return this.read(
      operationId,
      async (tx, channelId, runManifest) => {
        // Another Thread is read as it is now; the run's own conversation keeps its cutoff.
        const other =
          params.threadId && params.threadId !== runManifest.threadId
            ? await findThread(tx, channelId, params.threadId)
            : null;
        const manifest = other ? liveThreadManifest(runManifest, other) : runManifest;
        const rows = await readManifestMessages(tx, channelId, manifest, {
          beforeSequence,
          limit: limit + 1,
        });
        const hasMore = rows.length > limit;
        const page = rows.slice(-limit);
        return {
          cutoffSequence: other ? (page.at(-1)?.sequence ?? 0) : manifest.cutoffSequence,
          messages: page.map((message) => excerpt(message, 0, EXCERPT_LENGTH)),
          nextBeforeSequence: hasMore ? page[0].sequence : null,
        };
      },
      { allowShared: true },
    );
  };

  readMessage = async (
    operationId: string,
    params: ChannelReadMessageParams,
  ): Promise<ChannelHistoryMessageDetail> => {
    if (!params.messageId?.trim()) throw new ChannelError('BAD_REQUEST', 'messageId is required');
    const offset = integer(params.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    return this.read(
      operationId,
      async (tx, channelId, runManifest) => {
        // A message `readMessages({ threadId })` returned is read in that same live scope.
        const other =
          params.threadId && params.threadId !== runManifest.threadId
            ? await findThread(tx, channelId, params.threadId)
            : null;
        const manifest = other ? liveThreadManifest(runManifest, other) : runManifest;
        const [message] = await readManifestMessages(tx, channelId, manifest, {
          messageId: params.messageId,
        });
        if (!message) throw new ChannelError('NOT_FOUND', 'Message not found in this conversation');
        if (offset > message.content.length)
          throw new ChannelError('BAD_REQUEST', 'Offset exceeds message length');
        const result = excerpt(message, offset, DETAIL_LENGTH);
        return {
          message: result,
          nextOffset: result.truncated ? offset + DETAIL_LENGTH : null,
          offset,
        };
      },
      { allowShared: true },
    );
  };
}

/** Largest `channel_messages.sequence` (int4): no cutoff. */
const LATEST_SEQUENCE = 2_147_483_647;

/**
 * A Thread's whole branch up to its latest message, for reading it from another conversation.
 * The run's own request belongs to the run's conversation, not this Thread, so the Thread's root
 * stands in for it: the scope then adds only the requests continued in this Thread.
 */
const liveThreadManifest = (
  manifest: ChannelInputManifest,
  thread: { id: string; rootMessageId: string; rootSequence: number },
): ChannelInputManifest => ({
  ...manifest,
  cutoffSequence: LATEST_SEQUENCE,
  requestMessageId: thread.rootMessageId,
  threadId: thread.id,
  threadRootSequence: thread.rootSequence,
});

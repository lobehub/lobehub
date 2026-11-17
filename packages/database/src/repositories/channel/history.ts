import type {
  ChannelAgentExchange,
  ChannelContextMessage,
  ChannelHistoryMessage,
  ChannelHistoryMessageDetail,
  ChannelHistoryPage,
  ChannelInputManifest,
  ChannelMessageVia,
  ChannelReadMessageParams,
  ChannelReadMessagesParams,
} from '@lobechat/types';
import {
  agentDisplayName,
  channelAgentExchange,
  channelMessageVia,
  RequestTrigger,
} from '@lobechat/types';
import { and, eq, isNull } from 'drizzle-orm';

import {
  agentOperations,
  agents,
  channelJobs,
  channelMessages,
  workspaceMembers,
} from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { normalizeWorkspaceId } from '../../utils/workspace';
import { activeMembers, findThread } from './delivery';
import { ChannelError } from './error';
import { readManifestMessages } from './manifest';
import { withChannelLock } from './transaction';

const EXCERPT_LENGTH = 2000;
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
      // An archived branch leaves Agent context even for a run that already started in it.
      if ((await findThread(tx, channel.id, job.manifest.threadId))?.status === 'archived')
        throw new ChannelError('CONFLICT', 'Channel operation is no longer active');
      return fn(tx, channel.id, job.manifest);
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
   * live bot run, and only when the caller says so (`allowBotRun`): the bot's owner asked their
   * Agent from an IM platform to post into one of their Channels. Only a caller holding that run's
   * `channel:message` token, minted only for an owner's bot message, may set it; the trigger is
   * checked again here so no other run without a Channel can relay.
   */
  relaySource = async (
    operationId: string,
    { allowBotRun = false }: { allowBotRun?: boolean } = {},
  ): Promise<{
    /** The Channel run, with what {@link currentRun} reads; absent for a bot run. */
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
    if (job || !allowBotRun) {
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
        agentTitle: agents.title,
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
      operation.trigger !== RequestTrigger.Bot
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
      async (tx, channelId, manifest) => {
        const rows = await readManifestMessages(tx, channelId, manifest, {
          beforeSequence,
          limit: limit + 1,
        });
        const hasMore = rows.length > limit;
        const page = rows.slice(-limit);
        return {
          cutoffSequence: manifest.cutoffSequence,
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
      async (tx, channelId, manifest) => {
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

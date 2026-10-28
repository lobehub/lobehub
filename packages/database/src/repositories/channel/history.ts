import type {
  ChannelContextMessage,
  ChannelHistoryMessage,
  ChannelHistoryMessageDetail,
  ChannelHistoryPage,
  ChannelInputManifest,
  ChannelReadMessageParams,
  ChannelReadMessagesParams,
} from '@lobechat/types';
import { and, eq, isNull } from 'drizzle-orm';

import { agentOperations, channelJobs, workspaceMembers } from '../../schemas';
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
      if (
        !row ||
        row.operation.userId !== this.userId ||
        row.operation.workspaceId !== this.workspaceId ||
        channel.workspaceId !== this.workspaceId ||
        (channel.agentId && channel.userId !== this.userId)
      )
        throw new ChannelError('NOT_FOUND', 'Channel operation not found');
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
        requester.userId !== this.userId ||
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

  readMessages = async (
    operationId: string,
    params: ChannelReadMessagesParams = {},
  ): Promise<ChannelHistoryPage> => {
    const limit = integer(params.limit, 10, 1, 20);
    const beforeSequence =
      params.beforeSequence === undefined
        ? undefined
        : integer(params.beforeSequence, 1, 1, Number.MAX_SAFE_INTEGER);
    return this.read(operationId, async (tx, channelId, manifest) => {
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
    });
  };

  readMessage = async (
    operationId: string,
    params: ChannelReadMessageParams,
  ): Promise<ChannelHistoryMessageDetail> => {
    if (!params.messageId?.trim()) throw new ChannelError('BAD_REQUEST', 'messageId is required');
    const offset = integer(params.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    return this.read(operationId, async (tx, channelId, manifest) => {
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
    });
  };
}

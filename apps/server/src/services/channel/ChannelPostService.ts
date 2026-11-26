import type {
  ChannelMessageSurface,
  ChannelPostedMessage,
  ChannelPostMessageParams,
} from '@lobechat/types';
import { CHANNEL_LIMITS } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import {
  ChannelError,
  ChannelHistoryRepository,
  ChannelRepository,
} from '@/database/repositories/channel';
import { channelThreads } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { notTrashed } from '@/database/utils/softDelete';

import { channelUrl } from './channelUrl';
import { channelContacts } from './contacts';
import { assertChannelEnabled } from './featureGate';
import { notifyChannel } from './notify';
import { runSurfaces, unpostedRunSurfaces } from './runSurfaces';

/**
 * Lets a Channel run post as its own Agent somewhere other than where it is answering
 * (`lobe-channel.postMessage`): the main timeline or a Thread of its Channel, or of another
 * Channel the requester and the Agent are active members of. Agents may speak where they were not
 * called; the target Channel's own guards still apply (Agent active and unmuted, Channel not
 * archived, requester a member). The post carries the cards the run drew, answers no request and
 * wakes no one. The run itself (live, unrevoked, requester still a member) is checked first,
 * exactly as a history read checks it.
 */
export class ChannelPostService {
  private readonly history: ChannelHistoryRepository;
  private readonly channels: ChannelRepository;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly operationId: string,
    private readonly workspaceId?: string,
  ) {
    this.history = new ChannelHistoryRepository(db, userId, workspaceId);
    this.channels = new ChannelRepository(db, userId, workspaceId, channelContacts);
  }

  /**
   * `requestId` (the tool call id) makes a retried call return the message it already posted.
   * Cards: those this run drew and has not posted yet (`lobe-a2ui.renderUI`), unless
   * `includeCards` is false; `surfaceIds` names the cards instead, a card already posted included
   * (its latest drawing). With cards the text may be empty. The result names the cards it carried,
   * so neither a later post nor the run's own answer carries them again.
   */
  postMessage = async (
    params: ChannelPostMessageParams,
    requestId: string,
  ): Promise<ChannelPostedMessage> => {
    await assertChannelEnabled(this.userId);
    const run = await this.history.currentRun(this.operationId);
    const channelId = params.channelId?.trim() || run.channelId;
    // Read before the Thread, so a Channel the requester is not in tells nothing about its Threads.
    const access = await this.channels.findAccess(channelId);
    if (!access) throw new ChannelError('NOT_FOUND', 'Channel not found, or you are not a member');
    const threadId = await this.openThread(channelId, params.threadId?.trim() || null);
    if (channelId === run.channelId && threadId === run.manifest.threadId)
      throw new ChannelError(
        'BAD_REQUEST',
        'That is where you are answering; your final answer is posted there',
      );
    const content = params.content?.trim() ?? '';
    if (content.length > CHANNEL_LIMITS.contentLength)
      throw new ChannelError('BAD_REQUEST', 'The message is too long');
    const surfaces = params.includeCards === false ? [] : await this.runCards(params.surfaceIds);
    if (!content && !surfaces.length)
      throw new ChannelError(
        'BAD_REQUEST',
        'Give content, or draw a card with lobe-a2ui renderUI in this run first (cards you already posted are not posted again unless you name them in surfaceIds)',
      );

    const message = await this.channels.postAgentMessage(channelId, {
      agentId: run.manifest.self.agentId,
      content,
      metadata: { operationId: this.operationId, source: 'agent-post' },
      requestKey: `agent-post:${this.operationId}:${requestId}`,
      ...(surfaces.length > 0 && { surfaces }),
      threadId,
    });
    await notifyChannel(this.db, channelId);

    return {
      cards: surfaces.length,
      channelId,
      channelTitle: access.channel.title,
      messageId: message.id,
      surfaceIds: [...new Set(surfaces.map((surface) => surface.surfaceId))],
      threadId: message.threadId,
      url: await channelUrl(
        this.db,
        { userId: this.userId, workspaceId: this.workspaceId },
        channelId,
        access.channel.projectId,
      ),
    };
  };

  /**
   * The Thread a post goes to, checked before the post: one that is gone is refused, and an
   * archived one too, since the post would otherwise land on the main timeline, possibly where
   * this run is answering.
   */
  private openThread = async (channelId: string, threadId: string | null) => {
    if (!threadId) return null;
    const [thread] = await this.db
      .select({ status: channelThreads.status })
      .from(channelThreads)
      .where(
        and(
          eq(channelThreads.channelId, channelId),
          eq(channelThreads.id, threadId),
          notTrashed(channelThreads.isDeleted),
        ),
      )
      .limit(1);
    if (!thread) throw new ChannelError('NOT_FOUND', 'Thread not found in that Channel');
    if (thread.status === 'archived')
      throw new ChannelError(
        'CONFLICT',
        'That Thread is archived; post on the main timeline or another Thread',
      );
    return threadId;
  };

  /**
   * The cards this post carries, read from the run's Topic: the named ones (latest drawing of
   * each), or else every card the run drew and no earlier post of it carried.
   */
  private runCards = async (surfaceIds?: string[]): Promise<ChannelMessageSurface[]> => {
    const operation = await new AgentOperationModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findById(this.operationId);
    const named = surfaceIds?.map((id) => id.trim()).filter(Boolean);
    if (!operation?.topicId) {
      if (named?.length) throw new ChannelError('BAD_REQUEST', 'No card drawn in this run');
      return [];
    }
    const messages = new MessageModel(this.db, this.userId, this.workspaceId);
    if (!named?.length) return unpostedRunSurfaces(messages, this.operationId, operation.topicId);

    const latest = new Map(
      (await runSurfaces(messages, this.operationId, operation.topicId)).map((surface) => [
        surface.surfaceId,
        surface,
      ]),
    );
    const missing = named.filter((id) => !latest.has(id));
    if (missing.length)
      throw new ChannelError(
        'BAD_REQUEST',
        `No card ${missing.join(', ')} drawn in this run; draw it with lobe-a2ui renderUI first`,
      );
    return [...new Set(named)].map((id) => latest.get(id)!);
  };
}

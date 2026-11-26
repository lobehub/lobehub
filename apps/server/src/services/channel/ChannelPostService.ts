import type { ChannelPostedMessage, ChannelPostMessageParams } from '@lobechat/types';
import { CHANNEL_LIMITS } from '@lobechat/types';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { WorkspaceModel } from '@/database/models/workspace';
import {
  ChannelError,
  ChannelHistoryRepository,
  ChannelRepository,
} from '@/database/repositories/channel';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';

import { channelContacts } from './contacts';
import { assertChannelEnabled } from './featureGate';
import { notifyChannel } from './notify';
import { runSurfaces } from './runSurfaces';

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
   * Cards: every surface this run drew (`lobe-a2ui.renderUI`) unless `includeCards` is false; with
   * cards the text may be empty.
   */
  postMessage = async (
    params: ChannelPostMessageParams,
    requestId: string,
  ): Promise<ChannelPostedMessage> => {
    await assertChannelEnabled(this.userId);
    const run = await this.history.currentRun(this.operationId);
    const channelId = params.channelId?.trim() || run.channelId;
    const threadId = params.threadId?.trim() || null;
    if (channelId === run.channelId && threadId === run.manifest.threadId)
      throw new ChannelError(
        'BAD_REQUEST',
        'That is where you are answering; your final answer is posted there',
      );
    const content = params.content?.trim() ?? '';
    if (content.length > CHANNEL_LIMITS.contentLength)
      throw new ChannelError('BAD_REQUEST', 'The message is too long');
    const surfaces = params.includeCards === false ? [] : await this.runCards();
    if (!content && !surfaces.length)
      throw new ChannelError(
        'BAD_REQUEST',
        'Give content, or draw a card with lobe-a2ui renderUI in this run first',
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
    const access = await this.channels.findAccess(channelId);

    return {
      cards: surfaces.length,
      channelId,
      channelTitle: access?.channel.title ?? '',
      messageId: message.id,
      threadId: message.threadId,
      url: await this.channelUrl(channelId, access?.channel.projectId ?? null),
    };
  };

  /** The cards this run drew so far, read from its Topic. */
  private runCards = async () => {
    const operation = await new AgentOperationModel(
      this.db,
      this.userId,
      this.workspaceId,
    ).findById(this.operationId);
    if (!operation?.topicId) return [];
    return runSurfaces(
      new MessageModel(this.db, this.userId, this.workspaceId),
      this.operationId,
      operation.topicId,
    );
  };

  private async channelUrl(channelId: string, projectId: string | null) {
    const origin = appEnv.APP_URL.replace(/\/$/, '');
    const slug = this.workspaceId
      ? await new WorkspaceModel(this.db, this.userId)
          .findById(this.workspaceId)
          .then((workspace) => workspace?.slug ?? undefined)
          .catch(() => undefined)
      : undefined;
    const base = slug ? `${origin}/${slug}` : origin;
    return projectId
      ? `${base}/project/${projectId}/channels/${channelId}`
      : `${base}/channels/${channelId}`;
  }
}

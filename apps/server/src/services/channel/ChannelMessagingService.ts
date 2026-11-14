import type {
  ChannelDirectoryPage,
  ChannelListChannelsParams,
  ChannelSendMessageParams,
  ChannelSentMessage,
} from '@lobechat/types';
import { CHANNEL_LIMITS } from '@lobechat/types';

import { WorkspaceModel } from '@/database/models/workspace';
import {
  ChannelError,
  ChannelHistoryRepository,
  ChannelRepository,
} from '@/database/repositories/channel';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';

import { ChannelService } from './ChannelService';
import { assertChannelEnabled } from './featureGate';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
/** Agents one relayed request may address; more is a broadcast, not a message. */
const MAX_RECIPIENTS = 5;

const escapeRegExp = (value: string) => value.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');

/**
 * Lets a Channel run reach Agents in the requester's other Channels: list where they are, then
 * post a request there that @mentions them. The run's requester stays the sender and execution
 * identity, so the target Channel's own membership, routing and permissions decide what happens;
 * `metadata.via` only records which Agent relayed it. The run itself (live, unrevoked, requester
 * still a member) is checked first, exactly as a history read checks it.
 */
export class ChannelMessagingService {
  private readonly history: ChannelHistoryRepository;
  private readonly channels: ChannelRepository;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly operationId: string,
    private readonly workspaceId?: string,
  ) {
    this.history = new ChannelHistoryRepository(db, userId, workspaceId);
    this.channels = new ChannelRepository(db, userId, workspaceId);
  }

  listChannels = async (params: ChannelListChannelsParams = {}): Promise<ChannelDirectoryPage> => {
    await assertChannelEnabled(this.userId);
    const run = await this.history.currentRun(this.operationId);
    const limit = params.limit ?? DEFAULT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT)
      throw new ChannelError('BAD_REQUEST', `Expected a limit between 1 and ${MAX_LIMIT}`);
    const query = params.query?.trim().toLowerCase();

    const matched = (await this.channels.directory()).filter(
      ({ agents, channel }) =>
        (!params.agentId || agents.some((agent) => agent.agentId === params.agentId)) &&
        (!query ||
          (channel.title ?? '').toLowerCase().includes(query) ||
          agents.some((agent) => agent.name.toLowerCase().includes(query))),
    );
    return {
      channels: matched.slice(0, limit).map(({ agents, channel }) => ({
        agents: agents.map(({ agentId, description, name }) => ({ agentId, description, name })),
        current: channel.id === run.channelId,
        id: channel.id,
        kind: channel.agentId ? 'direct' : 'group',
        projectId: channel.projectId,
        title: channel.title ?? '',
      })),
      hasMore: matched.length > limit,
    };
  };

  /**
   * `requestId` (the tool call id, or the CLI's request key) makes a retried call return the
   * message it already posted.
   */
  sendMessage = async (
    params: ChannelSendMessageParams,
    requestId: string,
  ): Promise<ChannelSentMessage> => {
    await assertChannelEnabled(this.userId);
    const run = await this.history.currentRun(this.operationId);
    // One hop only: a relayed request is answered where it arrived, so two Agents cannot keep
    // relaying to each other on the requester's behalf.
    if (run.requestVia)
      throw new ChannelError(
        'FORBIDDEN',
        `This request was relayed by ${run.requestVia.name}; answer it here instead of relaying it again`,
      );
    if (params.channelId === run.channelId)
      throw new ChannelError(
        'BAD_REQUEST',
        'That is the Channel you are answering in; your final answer is posted there',
      );
    const content = params.content?.trim();
    if (!content || content.length > CHANNEL_LIMITS.contentLength)
      throw new ChannelError('BAD_REQUEST', 'A message requires bounded content');
    const agentIds = [...new Set(params.agentIds ?? [])];
    if (!agentIds.length || agentIds.length > MAX_RECIPIENTS)
      throw new ChannelError(
        'BAD_REQUEST',
        `Address between 1 and ${MAX_RECIPIENTS} Agents with agentIds`,
      );
    if (agentIds.includes(run.manifest.self.agentId))
      throw new ChannelError('BAD_REQUEST', 'You cannot send a message to yourself');

    const target = (await this.channels.directory()).find(
      ({ channel }) => channel.id === params.channelId,
    );
    if (!target)
      throw new ChannelError(
        'NOT_FOUND',
        'Channel not found among the Channels you can post in; use listChannels',
      );
    const recipients = agentIds.map((agentId) =>
      target.agents.find((agent) => agent.agentId === agentId),
    );
    const missing = agentIds.filter((_, index) => !recipients[index]);
    if (missing.length)
      throw new ChannelError(
        'BAD_REQUEST',
        `Not an Agent member of "${target.channel.title}": ${missing.join(', ')}`,
      );
    const agents = recipients.map((agent) => agent!);

    // The timeline highlights `@Name` for mentioned members; lead with any the text left out.
    const unnamed = agents.filter(
      ({ name }) => !new RegExp(`@${escapeRegExp(name)}(?=$|[\\s\\p{P}\\p{S}])`, 'u').test(content),
    );
    const message = await new ChannelService(this.db, this.userId, this.workspaceId).send(
      params.channelId,
      {
        content: [...unnamed.map(({ name }) => `@${name}`), content].join(' '),
        mentions: agents.map(({ memberId }) => memberId),
        metadata: {
          via: {
            agentId: run.manifest.self.agentId,
            name: run.manifest.self.name,
            operationId: this.operationId,
            // Where the addressed Agents' replies are delivered back (`deliverRelayReceipts`).
            origin: { channelId: run.channelId, threadId: run.manifest.threadId },
          },
        },
        requestKey: `agent-relay:${this.operationId}:${requestId}`,
      },
    );

    return {
      agents: agents.map(({ agentId, name }) => ({ agentId, name })),
      channelId: target.channel.id,
      channelTitle: target.channel.title ?? '',
      messageId: message.id,
      url: await this.channelUrl(target.channel.id, target.channel.projectId),
    };
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

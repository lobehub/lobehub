import type {
  ChannelAgentExchange,
  ChannelDirectoryPage,
  ChannelListChannelsParams,
  ChannelSendMessageParams,
  ChannelSentMessage,
} from '@lobechat/types';
import { CHANNEL_LIMITS } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import {
  ChannelError,
  ChannelHistoryRepository,
  ChannelRepository,
  memberEnvironment,
} from '@/database/repositories/channel';
import {
  channelPeopleNames,
  findChannelRunRequester,
} from '@/database/repositories/channel/runRequester';
import { channelMembers } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { ChannelService } from './ChannelService';
import { channelUrl } from './channelUrl';
import { channelContacts } from './contacts';
import { assertChannelEnabled } from './featureGate';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

const escapeRegExp = (value: string) => value.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');
const mentionsName = (content: string, name: string) =>
  new RegExp(`@${escapeRegExp(name)}(?=$|[\\s\\p{P}\\p{S}])`, 'u').test(content);
/** Asks one exchange between Agents may take before the asking Agent must report back. */
const MAX_AGENT_ASKS = 3;

type ChannelRun = Awaited<ReturnType<ChannelHistoryRepository['currentRun']>>;
type DirectoryEntry = Awaited<ReturnType<ChannelRepository['directory']>>[number];
interface AgentLocation {
  agentId: string;
  /** A Channel where the person reaches the Agent, whose environment the Agent keeps. */
  channelId: string;
  memberId: string;
  name: string;
}

/**
 * Where the person reaches an Agent: its own conversation first (the environment they set up for
 * it), then the Channel the caller named, then any of their Channels it is in.
 */
const findAgent = (
  directory: DirectoryEntry[],
  agentId: string,
  channelId?: string,
): AgentLocation => {
  const located = (entry?: DirectoryEntry) => {
    const agent = entry?.agents.find((member) => member.agentId === agentId);
    return entry && agent
      ? { agentId, channelId: entry.channel.id, memberId: agent.memberId, name: agent.name }
      : undefined;
  };
  const found =
    located(directory.find(({ channel }) => channel.agentId === agentId)) ??
    located(directory.find(({ channel }) => channel.id === channelId)) ??
    directory.map((entry) => located(entry)).find(Boolean);
  if (!found)
    throw new ChannelError(
      'NOT_FOUND',
      `Agent ${agentId} is not in any Channel you can post in; use listChannels`,
    );
  return found;
};

/**
 * Lets a Channel run reach Agents in the requester's other Channels: list where they are, then ask
 * one in the conversation between the two Agents (`askAgent`). Nothing is ever posted as the
 * requester. The run itself (live, unrevoked, requester still a member) is checked first, exactly
 * as a history read checks it.
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
    this.channels = new ChannelRepository(db, userId, workspaceId, channelContacts);
  }

  listChannels = async (params: ChannelListChannelsParams = {}): Promise<ChannelDirectoryPage> => {
    await assertChannelEnabled(this.userId);
    const run = await this.history.currentRun(this.operationId, { allowShared: true });
    const limit = params.limit ?? DEFAULT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT)
      throw new ChannelError('BAD_REQUEST', `Expected a limit between 1 and ${MAX_LIMIT}`);
    const query = params.query?.trim().toLowerCase();

    // A shared Agent answering a visitor runs as its owner: it lists only the owner's Channels it
    // is in itself, the only ones it may post in (`ChannelPostService`).
    const requester = await findChannelRunRequester(
      this.db,
      run.channelId,
      run.manifest.requesterMemberId,
    );
    const forVisitor = !!requester && requester.userId !== this.userId;
    const selfAgentId = run.manifest.self.agentId;

    const directory = (await this.channels.directory()).filter(
      ({ agents, channel }) =>
        channel.id === run.channelId ||
        !forVisitor ||
        agents.some((agent) => agent.agentId === selfAgentId),
    );
    const people = await channelPeopleNames(
      this.db,
      directory.map(({ channel }) => channel.id),
    );
    const matched = directory.filter(
      ({ agents, channel }) =>
        (!params.agentId || agents.some((agent) => agent.agentId === params.agentId)) &&
        (!query ||
          (channel.title ?? '').toLowerCase().includes(query) ||
          agents.some((agent) => agent.name.toLowerCase().includes(query)) ||
          (people.get(channel.id) ?? []).some((name) => name.toLowerCase().includes(query))),
    );
    return {
      channels: matched.slice(0, limit).map(({ agents, channel }) => ({
        agents: agents.map(({ agentId, description, name }) => ({ agentId, description, name })),
        current: channel.id === run.channelId,
        id: channel.id,
        kind: channel.agentId ? 'direct' : channel.agentPairKey ? 'agents' : 'group',
        people: people.get(channel.id) ?? [],
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
    // A request an Agent posted (a Thread it opened, a scheduled report) is answered, not passed on.
    if (run.requestVia)
      throw new ChannelError(
        'FORBIDDEN',
        `${run.requestVia.name} posted this request; answer it here instead of asking further`,
      );
    // An Agent that was asked answers the Agent that asked; it does not pass the question on.
    if (run.requestByAgent)
      throw new ChannelError(
        'FORBIDDEN',
        'Another Agent asked you this; answer it here instead of asking further',
      );
    const content = params.content?.trim();
    if (!content || content.length > CHANNEL_LIMITS.contentLength)
      throw new ChannelError('BAD_REQUEST', 'A message requires bounded content');
    const agentIds = [...new Set(params.agentIds ?? [])];
    if (agentIds.length !== 1)
      throw new ChannelError(
        'BAD_REQUEST',
        'Ask one Agent per call, in the conversation between you two; call again for each other Agent',
      );
    if (agentIds[0] === run.manifest.self.agentId)
      throw new ChannelError('BAD_REQUEST', 'You cannot send a message to yourself');

    // Asked in the conversation between the two Agents, wherever it was found, so neither a
    // person's conversation nor a group Channel carries the exchange.
    return this.askAgent(
      run,
      findAgent(await this.channels.directory(), agentIds[0], params.channelId),
      content,
      requestId,
    );
  };

  /**
   * Asks one Agent in the conversation between it and the asking Agent, opened on first use with
   * each Agent's environment from where the person already talks to it. The asking Agent writes
   * the request; the person stays the requester and execution identity. The answer wakes the
   * asking Agent there (`deliverAnswerToAsker`), and what it then concludes is posted where the
   * exchange began (`reportAgentExchange`). An exchange takes at most `MAX_AGENT_ASKS` asks.
   */
  private askAgent = async (
    run: ChannelRun,
    other: AgentLocation,
    content: string,
    requestId: string,
  ): Promise<ChannelSentMessage> => {
    const self = run.manifest.self;
    const hops = (run.exchange?.hops ?? 0) + 1;
    if (hops > MAX_AGENT_ASKS)
      throw new ChannelError(
        'FORBIDDEN',
        `You have asked ${MAX_AGENT_ASKS} times in this exchange; tell the person what you have instead`,
      );
    const environment = async (channelId: string, memberId: string) => {
      const [member] = await this.db
        .select({ config: channelMembers.config })
        .from(channelMembers)
        .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.id, memberId)))
        .limit(1);
      return memberEnvironment(member?.config);
    };
    const pair = await this.channels.openAgentPair({
      agents: [
        {
          agentId: self.agentId,
          config: await environment(run.channelId, self.memberId),
          name: self.name,
        },
        {
          agentId: other.agentId,
          config: await environment(other.channelId, other.memberId),
          name: other.name,
        },
      ],
      title: `${self.name} · ${other.name}`.slice(0, CHANNEL_LIMITS.titleLength),
    });
    const author = pair.agents.find((agent) => agent.agentId === self.agentId);
    const recipient = pair.agents.find((agent) => agent.agentId === other.agentId);
    if (!author || !recipient)
      throw new ChannelError('CONFLICT', 'The conversation between Agents is missing an Agent');
    const name = recipient.name ?? other.name;

    const message = await new ChannelService(this.db, this.userId, this.workspaceId).send(
      pair.channel.id,
      {
        authorAgentMemberId: author.id,
        content: mentionsName(content, name) ? content : `@${name} ${content}`,
        mentions: [recipient.id],
        metadata: {
          exchange: {
            hops,
            // Where what the asking Agent concludes from the answer is posted.
            origin: run.exchange?.origin ?? {
              channelId: run.channelId,
              threadId: run.manifest.threadId,
            },
          } satisfies ChannelAgentExchange,
        },
        requestKey: `agent-ask:${this.operationId}:${requestId}`,
      },
    );

    return {
      agents: [{ agentId: other.agentId, name }],
      channelId: pair.channel.id,
      channelTitle: pair.channel.title,
      messageId: message.id,
      url: await this.channelUrl(pair.channel.id, pair.channel.projectId),
    };
  };

  private channelUrl = (channelId: string, projectId: string | null) =>
    channelUrl(
      this.db,
      { userId: this.userId, workspaceId: this.workspaceId },
      channelId,
      projectId,
    );
}

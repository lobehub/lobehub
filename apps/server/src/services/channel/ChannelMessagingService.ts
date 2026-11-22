import type {
  ChannelAgentExchange,
  ChannelDirectoryPage,
  ChannelListChannelsParams,
  ChannelListPeopleParams,
  ChannelMessagePersonParams,
  ChannelPeoplePage,
  ChannelPerson,
  ChannelSendMessageParams,
  ChannelSentMessage,
  ChannelSentPersonMessage,
  ContactUserProfile,
} from '@lobechat/types';
import { CHANNEL_LIMITS } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import { getAddressBook } from '@/business/server/contact/addressBook';
import { WorkspaceModel } from '@/database/models/workspace';
import {
  ChannelError,
  ChannelHistoryRepository,
  ChannelRepository,
  memberEnvironment,
} from '@/database/repositories/channel';
import { channelMembers } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';

import { ChannelService } from './ChannelService';
import { channelContacts } from './contacts';
import { assertChannelEnabled } from './featureGate';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
/** Agents one relayed request may address; more is a broadcast, not a message. */
const MAX_RECIPIENTS = 5;

const escapeRegExp = (value: string) => value.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');
const mentionsName = (content: string, name: string) =>
  new RegExp(`@${escapeRegExp(name)}(?=$|[\\s\\p{P}\\p{S}])`, 'u').test(content);
/** Asks one exchange between Agents may take before the asking Agent must report back. */
const MAX_AGENT_ASKS = 3;

const toPerson = (user: ContactUserProfile): ChannelPerson => ({
  name: user.fullName?.trim() || user.username || 'Unnamed',
  userId: user.id,
  username: user.username,
});

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
 * Lets a Channel run reach Agents in the requester's other Channels: list where they are, then
 * post a request there that @mentions them. The run's requester stays the sender and execution
 * identity, so the target Channel's own membership, routing and permissions decide what happens;
 * `metadata.via` only records which Agent relayed it. The run itself (live, unrevoked, requester
 * still a member) is checked first, exactly as a history read checks it.
 *
 * The bot's owner messaging their Agent on an IM platform may do the same from that bot run. It
 * has no Channel of its own, so nothing is current, and the reply stays in the target Channel:
 * there is no origin to deliver a receipt back to. Only the CLI route, which has checked the
 * run's operation token for `channel:message`, opts in (`allowBotRun`).
 */
export class ChannelMessagingService {
  private readonly history: ChannelHistoryRepository;
  private readonly channels: ChannelRepository;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly operationId: string,
    private readonly workspaceId?: string,
    private readonly options: { allowBotRun?: boolean } = {},
  ) {
    this.history = new ChannelHistoryRepository(db, userId, workspaceId);
    this.channels = new ChannelRepository(db, userId, workspaceId, channelContacts);
  }

  listChannels = async (params: ChannelListChannelsParams = {}): Promise<ChannelDirectoryPage> => {
    await assertChannelEnabled(this.userId);
    const run = await this.history.relaySource(this.operationId, this.options);
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
        current: channel.id === run.origin?.channelId,
        id: channel.id,
        kind: channel.agentId ? 'direct' : channel.agentPairKey ? 'agents' : 'group',
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
    const run = await this.history.relaySource(this.operationId, this.options);
    // One hop only: a relayed request is answered where it arrived, so two Agents cannot keep
    // relaying to each other on the requester's behalf.
    if (run.requestVia)
      throw new ChannelError(
        'FORBIDDEN',
        `This request was relayed by ${run.requestVia.name}; answer it here instead of relaying it again`,
      );
    // An Agent that was asked answers the Agent that asked; it does not pass the question on.
    if (run.channelRun?.requestByAgent)
      throw new ChannelError(
        'FORBIDDEN',
        'Another Agent asked you this; answer it here instead of asking further',
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
    if (agentIds.includes(run.self.agentId))
      throw new ChannelError('BAD_REQUEST', 'You cannot send a message to yourself');

    const directory = await this.channels.directory();
    // One Agent is always asked in the conversation between the two Agents, wherever it was
    // found, so neither a person's conversation nor a group Channel carries the exchange. A bot
    // run has no Channel for the conclusion to come back to, so it relays like a group message.
    if (run.channelRun && agentIds.length === 1)
      return this.askAgent(
        run.channelRun,
        findAgent(directory, agentIds[0], params.channelId),
        content,
        requestId,
      );

    if (!params.channelId)
      throw new ChannelError(
        'BAD_REQUEST',
        'Give channelId to address several Agents in one group Channel',
      );
    const target = directory.find(({ channel }) => channel.id === params.channelId);
    if (!target)
      throw new ChannelError(
        'NOT_FOUND',
        'Channel not found among the Channels you can post in; use listChannels',
      );
    if (params.channelId === run.origin?.channelId)
      throw new ChannelError(
        'BAD_REQUEST',
        'That is the Channel you are answering in; your final answer is posted there',
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
    const unnamed = agents.filter(({ name }) => !mentionsName(content, name));
    const message = await new ChannelService(this.db, this.userId, this.workspaceId).send(
      target.channel.id,
      {
        content: [...unnamed.map(({ name }) => `@${name}`), content].join(' '),
        mentions: agents.map(({ memberId }) => memberId),
        metadata: {
          via: {
            agentId: run.self.agentId,
            name: run.self.name,
            operationId: this.operationId,
            // Where the addressed Agents' replies are delivered back (`deliverRelayReceipts`).
            ...(run.origin && { origin: run.origin }),
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

  /**
   * People the requester can message one-on-one in the run's scope, to find who `messagePerson`
   * can reach: personal contacts, or in a workspace its members and the external contacts paired
   * with the requester.
   */
  listPeople = async (params: ChannelListPeopleParams = {}): Promise<ChannelPeoplePage> => {
    await assertChannelEnabled(this.userId);
    await this.history.relaySource(this.operationId, this.options);
    const limit = params.limit ?? DEFAULT_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT)
      throw new ChannelError('BAD_REQUEST', `Expected a limit between 1 and ${MAX_LIMIT}`);
    const page = await getAddressBook(this.db, this.userId, this.workspaceId).listPeople({
      limit,
      query: params.query,
    });
    return { hasMore: page.hasMore, people: page.people.map(toPerson) };
  };

  /**
   * Messages one person for the requester, in the requester's conversation with them, opened on
   * first use. That conversation decides who can be reached (a mutual contact, or a fellow member
   * or paired external contact in a workspace) and notifies the person of every message. The
   * requester stays the sender; `metadata.via` names the Agent that wrote it. No Agent answers
   * there, so nothing comes back to the run.
   *
   * `requestId` (the tool call id, or the CLI's request key) makes a retried call return the
   * message it already posted.
   */
  messagePerson = async (
    params: ChannelMessagePersonParams,
    requestId: string,
  ): Promise<ChannelSentPersonMessage> => {
    await assertChannelEnabled(this.userId);
    const run = await this.history.relaySource(this.operationId, this.options);
    const content = params.content?.trim();
    if (!content || content.length > CHANNEL_LIMITS.contentLength)
      throw new ChannelError('BAD_REQUEST', 'A message requires bounded content');
    const userId = params.userId?.trim();
    if (!userId)
      throw new ChannelError('BAD_REQUEST', 'Give the userId of a person from listPeople');
    if (userId === this.userId)
      throw new ChannelError(
        'BAD_REQUEST',
        'That is your requester; your final answer already reaches them',
      );

    const service = new ChannelService(this.db, this.userId, this.workspaceId);
    const access = await service.openPeer(userId).catch((error: unknown) => {
      if (
        error instanceof ChannelError &&
        (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND')
      )
        throw new ChannelError(
          error.code,
          `${error.message}: your requester cannot message this person; use listPeople`,
        );
      throw error;
    });
    if (access.channel.isDeleted)
      throw new ChannelError(
        'FORBIDDEN',
        'The conversation with this person is in the trash; your requester can restore it',
      );
    const message = await service.send(access.channel.id, {
      content,
      metadata: {
        via: { agentId: run.self.agentId, name: run.self.name, operationId: this.operationId },
      },
      requestKey: `agent-dm:${this.operationId}:${requestId}`,
    });
    const person = await getAddressBook(this.db, this.userId, this.workspaceId).findUser(userId);

    return {
      channelId: access.channel.id,
      messageId: message.id,
      person: person ? toPerson(person) : { name: 'Unnamed', userId, username: null },
      url: await this.channelUrl(access.channel.id, access.channel.projectId),
    };
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

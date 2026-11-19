import { BUILTIN_AGENT_SLUGS } from '@lobechat/builtin-agents';
import { isHeterogeneousAgentModelId } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import type { ChannelVisibility } from '@lobechat/types';
import {
  agentDisplayName,
  CHANNEL_LIMITS,
  defaultChannelAgentDirectory,
  isChannelRuntime,
  isRemoteChannelRuntime,
} from '@lobechat/types';
import { eq } from 'drizzle-orm';
import pMap from 'p-map';

import { AgentShareModel } from '@/database/models/agentShare';
import { ContactModel, parseContactHandle } from '@/database/models/contact';
import { DeviceModel } from '@/database/models/device';
import type { ProjectModelOptions } from '@/database/models/project';
import { ProjectModel } from '@/database/models/project';
import type {
  ChannelAddAgentInput,
  ChannelSendInput,
  ChannelStopScope,
} from '@/database/repositories/channel';
import { ChannelError, ChannelRepository } from '@/database/repositories/channel';
import { findProjectMainChannelId } from '@/database/repositories/channel/projectMainChannel';
import { users } from '@/database/schemas';
import { AgentService } from '@/server/services/agent';
import { deviceGateway } from '@/server/services/deviceGateway';
import { FileService } from '@/server/services/file';

import { ChannelCoordinator } from './ChannelCoordinator';
import { notifyChannelDirectMessages } from './directMessage';
import { notifyChannelMentions } from './mention';
import { notifyChannel } from './notify';
import { wakeChannel } from './queue';
import { resolveChannelRoutingConfig } from './routingConfig';

/** Environment selection is a request, never trusted device ownership or canonical-path data. */
export interface ChannelAgentSelection {
  agentId: string;
  description?: string;
  deviceId?: string;
  name?: string;
  workingDirectory?: string;
}

type ChannelAgentConfig = NonNullable<Awaited<ReturnType<AgentService['getAgentConfigById']>>>;

/** An Agent's own runtime: external when it names a heterogeneous provider or model. */
const agentRuntime = (agent: Pick<ChannelAgentConfig, 'agencyConfig' | 'model'>) =>
  agent.agencyConfig?.heterogeneousProvider?.type ??
  (isHeterogeneousAgentModelId(agent.model) ? agent.model : 'native');

export class ChannelService {
  readonly repository: ChannelRepository;
  private readonly agentService: AgentService;
  private readonly deviceModel: DeviceModel;
  private readonly projectModel: ProjectModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
    /** The caller's project rights, for seating a new Agent in a project Channel's project. */
    private readonly projectOptions: ProjectModelOptions = {},
  ) {
    this.repository = new ChannelRepository(db, userId, workspaceId);
    this.agentService = new AgentService(db, userId, workspaceId);
    this.deviceModel = new DeviceModel(db, userId, workspaceId);
    this.projectModel = new ProjectModel(db, userId, workspaceId, projectOptions);
  }

  private async resolveAgent(
    input: ChannelAgentSelection,
    /** The Agent's config when the caller already loaded it. */
    loaded?: ChannelAgentConfig,
  ): Promise<ChannelAddAgentInput> {
    const agent = loaded ?? (await this.agentService.getAgentConfigById(input.agentId));
    if (!agent) throw new ChannelError('NOT_FOUND', 'Agent not found');
    const runtime = agentRuntime(agent);
    if (!isChannelRuntime(runtime))
      throw new ChannelError('BAD_REQUEST', 'Unsupported Channel runtime');
    const config: NonNullable<ChannelAddAgentInput['config']> = {};
    if (input.deviceId && isRemoteChannelRuntime(runtime))
      throw new ChannelError('BAD_REQUEST', 'A remote Agent runs on its own host, not a device');
    if (input.deviceId) {
      const device = this.workspaceId
        ? await this.deviceModel.findWorkspaceDeviceById(input.deviceId)
        : await this.deviceModel.findPersonalByDeviceId(input.deviceId);
      if (!device || (this.workspaceId && device.visibility !== 'public'))
        throw new ChannelError(
          'FORBIDDEN',
          'Choose an accessible device shared with this workspace',
        );
      // Early feedback only; the device itself refuses the Native scope. See executeDeviceOperation.
      if (runtime === 'native' && device.platform === 'win32')
        throw new ChannelError(
          'BAD_REQUEST',
          'Native Channel execution is not supported on Windows devices yet',
        );
      // An unpicked directory follows the Agent's own choice on this device, then the device's
      // default, then its home folder: the fallbacks an ordinary conversation uses.
      const workingDirectory =
        input.workingDirectory?.trim() ||
        defaultChannelAgentDirectory(agent.agencyConfig, device.deviceId, device.defaultCwd) ||
        (await deviceGateway.queryDeviceSystemInfo(this.userId, input.deviceId, this.workspaceId))
          ?.homePath;
      if (!workingDirectory)
        throw new ChannelError('BAD_REQUEST', 'Choose a working directory for this device');
      const path = await deviceGateway.statPath({
        deviceId: input.deviceId,
        path: workingDirectory,
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
      if (!path)
        throw new ChannelError(
          'BAD_REQUEST',
          'Could not reach the device to verify the working directory',
        );
      if (!path.isDirectory)
        throw new ChannelError(
          'BAD_REQUEST',
          'The working directory does not exist or is not a directory',
        );
      if (!path.canonicalPath)
        throw new ChannelError(
          'BAD_REQUEST',
          'The device connector must be upgraded to verify the working directory',
        );
      config.deviceId = device.deviceId;
      config.deviceOwnerId = device.userId;
      config.workingDirectory = path.canonicalPath;
    } else if (input.workingDirectory) {
      // A directory only means something on a device. Without one the Agent runs where its own
      // settings say, as in an ordinary conversation.
      throw new ChannelError('BAD_REQUEST', 'Choose an online device and working directory');
    }
    return { agentId: input.agentId, config, description: input.description, name: input.name };
  }

  /**
   * A project Channel seats only the project's own Agents. With `joinProject`, an Agent from
   * outside joins the project first, which takes the right to manage the project's members;
   * without it, the caller is told to add the Agent to the project.
   */
  private async seatAgentsInProject(projectId: string, agentIds: string[], joinProject?: boolean) {
    const missing: string[] = [];
    for (const agentId of new Set(agentIds))
      if (!(await this.projectModel.hasAgent(projectId, agentId))) missing.push(agentId);
    if (!missing.length) return;
    if (!joinProject) throw new ChannelError('CONFLICT', 'Add the Agent to the project first');
    const forbidden = new ChannelError(
      'FORBIDDEN',
      'Only the project creator or a workspace admin can add an Agent to the project',
    );
    if (this.projectOptions.readOnly) throw forbidden;
    for (const agentId of missing) {
      let binding: Awaited<ReturnType<ProjectModel['addAgent']>>;
      try {
        binding = await this.projectModel.addAgent(projectId, { agentId });
      } catch (error) {
        throw new ChannelError('BAD_REQUEST', (error as Error).message);
      }
      if (!binding) throw forbidden;
    }
  }

  /** A group starts with Agents, workspace people, both, or only its creator. */
  create = async (input: {
    agents: ChannelAgentSelection[];
    /** Seats Agents from outside the project in the project first. */
    joinProject?: boolean;
    projectId?: string;
    title: string;
    userIds?: string[];
  }) => {
    // The creator joins as owner anyway; naming them is not an invitation to notify about.
    const userIds = (input.userIds ?? []).filter((id) => id !== this.userId);
    // The project must be readable in this scope, the same visibility as the project list.
    if (input.projectId && !(await this.projectModel.findById(input.projectId)))
      throw new ChannelError('NOT_FOUND', 'Project not found');
    // Resolving probes devices, so cap the work one request can start.
    const agents = await pMap(input.agents, (agent) => this.resolveAgent(agent), {
      concurrency: 5,
    });
    if (input.projectId)
      await this.seatAgentsInProject(
        input.projectId,
        agents.map(({ agentId }) => agentId),
        input.joinProject,
      );
    const access = await this.repository.create({
      agents,
      projectId: input.projectId,
      title: input.title,
      userIds,
    });
    // Invited people see the new Channel without waiting for their next poll.
    if (userIds.length) await this.changed(access.channel.id);
    return access;
  };

  /**
   * The Channel a new workspace or project starts with. Callers pass a project they just created
   * in this scope, so its readability is not checked again.
   */
  createDefault = async (input: { agentId: string; projectId?: string; title: string }) => {
    const agentId = await this.defaultChannelAgent(input.agentId);
    return this.repository.create({
      agents: [{ agentId }],
      projectId: input.projectId,
      title: input.title,
    });
  };

  /**
   * Inviting into a direct conversation starts a group with its Agent and the invitees; the
   * direct conversation stays one person and one Agent.
   */
  createGroupFromDirect = async (
    channelId: string,
    input: { agents: ChannelAgentSelection[]; title: string; userIds: string[] },
  ) => {
    // Check membership before probing a device; the write rechecks the current admin role.
    if (!(await this.repository.findAccess(channelId)))
      throw new ChannelError('NOT_FOUND', 'Channel not found');
    const agents = await pMap(input.agents, (agent) => this.resolveAgent(agent), {
      concurrency: 5,
    });
    const access = await this.repository.createGroupFromDirect(channelId, {
      agents,
      title: input.title,
      userIds: input.userIds,
    });
    // Invitees see the new group without waiting for their next poll.
    await this.changed(access.channel.id);
    return access;
  };

  /**
   * The direct conversation between a person and an Agent, titled with the Agent's name. A Channel
   * binds no device by default: the Agent runs where its own settings say, as in an ordinary
   * conversation, until a member picks a device for it in the Channel.
   */
  createDirect = async (agentId: string) => {
    const agent = await this.agentService.getAgentConfigById(agentId);
    if (!agent) return this.createSharedDirect(agentId);
    if (!isChannelRuntime(agentRuntime(agent))) return;
    return this.repository.create({
      agentConfig: {},
      agentId,
      title: agentDisplayName(agent, 'Agent').slice(0, CHANNEL_LIMITS.titleLength),
    });
  };

  /**
   * Another person's Agent the caller added to their contacts through its link share; the entry
   * shows they reached the share. The repository rechecks the live share. A direct conversation
   * in the scope the Agent was added in, run in the cloud as the owner.
   */
  private createSharedDirect = async (agentId: string) => {
    const shared = await new ContactModel(this.db, this.userId, this.workspaceId).findAgentAccess(
      agentId,
    );
    if (!shared) return;
    return this.repository.create({
      agentConfig: {},
      agentId,
      sharedAgent: true,
      title: agentDisplayName(shared, 'Agent').slice(0, CHANNEL_LIMITS.titleLength),
    });
  };

  /**
   * The direct conversation with another person's Agent, opened from its share (id, handle or
   * pasted link) — no contact entry or friendship needed, since a link share is open to anyone
   * signed in. Adding it to contacts stays optional. One's own Agent opens as usual.
   */
  openShared = async (share: string) => {
    const key = parseContactHandle(share);
    const found = key ? await AgentShareModel.findBySlugOrId(this.db, key) : null;
    if (!found || found.visibility !== 'link')
      throw new ChannelError('NOT_FOUND', 'Agent not found');
    if (found.ownerId === this.userId) return this.openDirect(found.agentId);

    const existing = await this.repository.findDirectAccess(found.agentId);
    if (existing) return existing.channel.isDeleted ? undefined : existing;
    return this.repository.create({
      agentConfig: {},
      agentId: found.agentId,
      sharedAgent: true,
      title: agentDisplayName({ name: found.agentName, title: found.agentTitle }, 'Agent').slice(
        0,
        CHANNEL_LIMITS.titleLength,
      ),
    });
  };

  /**
   * The direct conversation a person opens with an existing Agent, e.g. one created before direct
   * Channels. An existing conversation opens as it is, without probing its device again; one the
   * person moved to the trash stays there, and the Agent opens as before.
   */
  openDirect = async (agentId: string) => {
    const existing = await this.repository.findDirectAccess(agentId);
    if (existing) return existing.channel.isDeleted ? undefined : existing;
    return this.createDirect(agentId);
  };

  /**
   * Where a person lands opening an Agent from their contacts or Agent list. A project's main Agent
   * talks in that project's Channel, so it opens there instead of a direct conversation beside it;
   * a direct conversation the person already has with it still opens as it is.
   */
  openAgent = async (agentId: string): Promise<string | undefined> => {
    const existing = await this.repository.findDirectAccess(agentId);
    if (existing) return existing.channel.isDeleted ? undefined : existing.channel.id;
    const projectChannelId = await findProjectMainChannelId(
      this.db,
      this.userId,
      this.workspaceId ?? null,
      agentId,
    );
    if (projectChannelId) return projectChannelId;
    return (await this.createDirect(agentId))?.channel.id;
  };

  /**
   * The one-on-one conversation with a contact (personal space) or a fellow member (workspace).
   * The stored title is the other person's name for
   * whoever opened it; clients title it with whoever the viewer is talking to.
   */
  openPeer = async (peerUserId: string) => {
    const [peer] = await this.db
      .select({ fullName: users.fullName, username: users.username })
      .from(users)
      .where(eq(users.id, peerUserId))
      .limit(1);
    if (!peer) throw new ChannelError('NOT_FOUND', 'User not found');
    const title = (peer.fullName?.trim() || peer.username || 'Conversation').slice(
      0,
      CHANNEL_LIMITS.titleLength,
    );
    const access = await this.repository.openPeer(peerUserId, title);
    await this.changed(access.channel.id);
    return access;
  };

  /**
   * The main Agent when it runs natively. An external Agent needs a device and directory that a
   * member picks when adding it, so the scope's LobeAI answers in the meantime.
   */
  private async defaultChannelAgent(agentId: string) {
    const agent = await this.agentService.getAgentConfigById(agentId);
    if (agent && agentRuntime(agent) === 'native') return agentId;
    const inbox = await this.agentService.getBuiltinAgent(BUILTIN_AGENT_SLUGS.inbox);
    if (!inbox?.id || agentRuntime(inbox) !== 'native')
      throw new ChannelError('NOT_FOUND', 'No Agent can answer in the default Channel');
    return inbox.id;
  }

  addAgent = async (
    channelId: string,
    input: ChannelAgentSelection,
    options: { joinProject?: boolean } = {},
  ) => {
    // Check membership before probing a device; the write rechecks the current admin role.
    const access = await this.repository.findAccess(channelId);
    if (!access) throw new ChannelError('NOT_FOUND', 'Channel not found');
    const agent = await this.resolveAgent(input);
    if (access.channel.projectId) {
      // Only an admin may add, so no one else can seat an Agent in the project through here.
      if (access.member.role === 'member')
        throw new ChannelError('FORBIDDEN', 'Requires the admin role in this channel');
      await this.seatAgentsInProject(
        access.channel.projectId,
        [agent.agentId],
        options.joinProject,
      );
    }
    const member = await this.repository.addAgent(channelId, agent);
    await this.changed(channelId);
    return member;
  };

  /** The member's Agent decides its runtime; the request only chooses where it runs. */
  updateAgentEnvironment = async (
    channelId: string,
    memberId: string,
    input: Pick<ChannelAgentSelection, 'deviceId' | 'workingDirectory'>,
  ) => {
    const { agentId } = await this.repository.agentEnvironment(channelId, memberId);
    const { config = {} } = await this.resolveAgent({ ...input, agentId });
    const member = await this.repository.updateAgentEnvironment(channelId, memberId, config);
    // A job blocked on the previous device or directory may be claimable now.
    await Promise.all([wakeChannel(channelId), this.changed(channelId)]);
    return member;
  };

  rename = async (channelId: string, title: string) => {
    const channel = await this.repository.rename(channelId, title);
    await this.changed(channelId);
    return channel;
  };

  editMessage = async (channelId: string, messageId: string, content: string) => {
    const message = await this.repository.editMessage(channelId, messageId, content);
    await this.changed(channelId);
    return message;
  };

  /** Replies the message asked for stop with it; the coordinator stops those still writing. */
  deleteMessage = async (channelId: string, messageId: string) => {
    const writers = await this.repository.deleteMessage(channelId, messageId);
    await new ChannelCoordinator(this.db).stopWriters(writers);
    await Promise.all([wakeChannel(channelId), this.changed(channelId)]);
  };

  addUser = async (channelId: string, userId: string) => {
    const member = await this.repository.addUser(channelId, userId);
    await this.changed(channelId);
    return member;
  };

  updateVisibility = async (channelId: string, visibility: ChannelVisibility) => {
    const channel = await this.repository.updateVisibility(channelId, visibility);
    await this.changed(channelId);
    return channel;
  };

  /** The coordinator physically stops a removed Agent's runs. */
  removeMember = async (channelId: string, memberId: string) => {
    const writers = await this.repository.removeMember(channelId, memberId);
    await new ChannelCoordinator(this.db).stopWriters(writers);
    await Promise.all([wakeChannel(channelId), this.changed(channelId)]);
  };

  leave = async (channelId: string) => {
    const result = await this.repository.leave(channelId);
    await this.changed(channelId);
    return result;
  };

  /**
   * Joins an open project Channel or a public one of the workspace. Members already in it see the
   * newcomer without waiting for their next poll.
   */
  join = async (channelId: string) => {
    const access = await this.repository.join(channelId);
    await this.changed(channelId);
    return access;
  };

  changed = (channelId: string) => notifyChannel(this.db, channelId);

  detail = async (channelId: string, options: Parameters<ChannelRepository['detail']>[1]) => {
    const view = await this.repository.detail(channelId, options);
    const files = new FileService(this.db, this.userId, this.workspaceId);
    // The public message's attachment relation grants this read after membership authorization.
    // Do not return private storage keys or route through an unrelated ordinary-chat ACL.
    return {
      ...view,
      attachments: await pMap(
        view.attachments,
        async (file) => ({ ...file, url: await files.getFullFileUrl(file.url, 300) }),
        { concurrency: 10 },
      ),
    };
  };

  remove = async (channelId: string) => {
    await this.repository.remove(channelId);
    // The coordinator physically stops revoked runs and retries unconfirmed exits.
    // Keep receipts and directory locks until then, without holding this request open.
    // A scheduling failure propagates; repeating the deletion safely schedules it again.
    await Promise.all([wakeChannel(channelId), this.changed(channelId)]);
  };

  /** Like `remove`, the coordinator physically stops the runs the archive revoked. */
  archive = async (channelId: string) => {
    await this.repository.archive(channelId);
    await Promise.all([wakeChannel(channelId), this.changed(channelId)]);
  };

  unarchive = async (channelId: string) => {
    await this.repository.unarchive(channelId);
    await this.changed(channelId);
  };

  archiveThread = async (channelId: string, threadId: string) => {
    await this.repository.archiveThread(channelId, threadId);
    await Promise.all([wakeChannel(channelId), this.changed(channelId)]);
  };

  unarchiveThread = async (channelId: string, threadId: string) => {
    await this.repository.unarchiveThread(channelId, threadId);
    await this.changed(channelId);
  };

  removeThread = async (channelId: string, threadId: string) => {
    await this.repository.removeThread(channelId, threadId);
    await Promise.all([wakeChannel(channelId), this.changed(channelId)]);
  };

  send = async (channelId: string, input: Omit<ChannelSendInput, 'routing'>) => {
    // Explicit reply and mention routing is decided by the repository.
    const config =
      input.replyToId || input.mentions?.length
        ? null
        : await resolveChannelRoutingConfig(this.db, this.userId);
    const message = await this.repository.send(channelId, {
      ...input,
      routing: config ? 'decision' : 'fallback',
    });
    const notifyContext = { userId: this.userId, workspaceId: this.workspaceId };
    notifyChannelMentions(this.db, notifyContext, message);
    notifyChannelDirectMessages(this.db, notifyContext, message);
    // A human quote without mentions only updates the public feed; it schedules no Agent work.
    if (message.replyToId && message.routingStatus === 'skipped') await this.changed(channelId);
    else await Promise.all([wakeChannel(channelId), this.changed(channelId)]);
    return message;
  };

  retryRouting = async (channelId: string, messageId: string) => {
    const message = await this.repository.retryRouting(channelId, messageId);
    await Promise.all([wakeChannel(channelId), this.changed(channelId)]);
    return message;
  };

  retryJob = async (channelId: string, jobId: string) => {
    const job = await this.repository.retryJob(channelId, jobId);
    await Promise.all([wakeChannel(channelId), this.changed(channelId)]);
    return job;
  };

  /** A muted Agent answers only @mentions; muting also stops what it is answering now. */
  setMemberMuted = async (channelId: string, memberId: string, muted: boolean) => {
    const writers = await this.repository.setMemberMuted(channelId, memberId, muted);
    await new ChannelCoordinator(this.db).stopWriters(writers);
    await Promise.all([wakeChannel(channelId), this.changed(channelId)]);
  };

  stop = async (channelId: string, scope: ChannelStopScope) => {
    const writers = await this.repository.stop(channelId, scope);
    await new ChannelCoordinator(this.db).stopWriters(writers);
    await Promise.all([wakeChannel(channelId), this.changed(channelId)]);
  };
}

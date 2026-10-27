import { isHeterogeneousAgentModelId } from '@lobechat/const';
import type { LobeChatDatabase } from '@lobechat/database';
import { isChannelRuntime } from '@lobechat/types';
import pMap from 'p-map';

import { DeviceModel } from '@/database/models/device';
import type {
  ChannelAddAgentInput,
  ChannelSendInput,
  ChannelStopScope,
} from '@/database/repositories/channel';
import { ChannelError, ChannelRepository } from '@/database/repositories/channel';
import { AgentService } from '@/server/services/agent';
import { deviceGateway } from '@/server/services/deviceGateway';
import { FileService } from '@/server/services/file';

import { ChannelCoordinator } from './ChannelCoordinator';
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

export class ChannelService {
  readonly repository: ChannelRepository;
  private readonly agentService: AgentService;
  private readonly deviceModel: DeviceModel;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly workspaceId?: string,
  ) {
    this.repository = new ChannelRepository(db, userId, workspaceId);
    this.agentService = new AgentService(db, userId, workspaceId);
    this.deviceModel = new DeviceModel(db, userId, workspaceId);
  }

  private async resolveAgent(input: ChannelAgentSelection): Promise<ChannelAddAgentInput> {
    const agent = await this.agentService.getAgentConfigById(input.agentId);
    if (!agent) throw new ChannelError('NOT_FOUND', 'Agent not found');
    const runtime =
      agent.agencyConfig?.heterogeneousProvider?.type ??
      (isHeterogeneousAgentModelId(agent.model) ? agent.model : 'native');
    if (!isChannelRuntime(runtime))
      throw new ChannelError('BAD_REQUEST', 'Unsupported Channel runtime');
    const config: NonNullable<ChannelAddAgentInput['config']> = {};
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
      if (!input.workingDirectory?.trim())
        throw new ChannelError('BAD_REQUEST', 'Choose a working directory for this device');
      const path = await deviceGateway.statPath({
        deviceId: input.deviceId,
        path: input.workingDirectory,
        userId: this.userId,
        workspaceId: this.workspaceId,
      });
      if (!path?.isDirectory || !path.canonicalPath)
        throw new ChannelError(
          'BAD_REQUEST',
          'The device must be online and support directory verification',
        );
      config.deviceId = device.deviceId;
      config.deviceOwnerId = device.userId;
      config.workingDirectory = path.canonicalPath;
    } else if (runtime !== 'native' || input.workingDirectory) {
      throw new ChannelError('BAD_REQUEST', 'Choose an online device and working directory');
    }
    return { agentId: input.agentId, config, description: input.description, name: input.name };
  }

  create = async (input: { agents: ChannelAgentSelection[]; title: string }) => {
    // Resolving probes devices, so cap the work one request can start.
    const agents = await pMap(input.agents, (agent) => this.resolveAgent(agent), {
      concurrency: 5,
    });
    return this.repository.create({ agents, title: input.title });
  };

  addAgent = async (channelId: string, input: ChannelAgentSelection) => {
    // Check membership before probing a device; the write rechecks the current admin role.
    if (!(await this.repository.findAccess(channelId)))
      throw new ChannelError('NOT_FOUND', 'Channel not found');
    const member = await this.repository.addAgent(channelId, await this.resolveAgent(input));
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

  addUser = async (channelId: string, userId: string) => {
    const member = await this.repository.addUser(channelId, userId);
    await this.changed(channelId);
    return member;
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
    const config = await resolveChannelRoutingConfig(this.db, this.userId);
    const message = await this.repository.send(channelId, {
      ...input,
      routing: config ? 'jev' : 'fallback',
    });
    // Do not swallow a queue failure: the client can retry the SAME request key safely.
    await Promise.all([wakeChannel(channelId), this.changed(channelId)]);
    return message;
  };

  retryRouting = async (channelId: string, messageId: string) => {
    const message = await this.repository.retryRouting(channelId, messageId);
    await Promise.all([wakeChannel(channelId), this.changed(channelId)]);
    return message;
  };

  stop = async (channelId: string, scope: ChannelStopScope) => {
    const writers = await this.repository.stop(channelId, scope);
    await new ChannelCoordinator(this.db).stopWriters(writers);
    await Promise.all([wakeChannel(channelId), this.changed(channelId)]);
  };
}

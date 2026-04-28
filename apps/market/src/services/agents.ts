import type {
  AgentCreateRequest,
  AgentCreateResponse,
  AgentEventRequest,
  AgentForkItem,
  AgentForkRequest,
  AgentForkResponse,
  AgentForkSourceResponse,
  AgentForksResponse,
  AgentInstallCountResponse,
  AgentItemDetail,
  AgentListQuery,
  AgentListResponse,
  AgentModifyRequest,
  AgentModifyResponse,
  AgentVersionCreateRequest,
  AgentVersionCreateResponse,
  AgentVersionModifyRequest,
  AgentVersionModifyResponse,
} from '@lobehub/market-sdk';

import type {
  MarketAgentItem,
  MarketAgentVersionItem,
  NewMarketAgent,
  NewMarketAgentVersion,
} from '../../../../packages/database/src/schemas/market';
import { MarketHttpError } from '../http/errors';
import type { AgentListParams } from '../models/agent';
import { AgentModel } from '../models/agent';
import type { MarketDatabase } from '../types';

interface AgentDetailOptions {
  includePrivateForAccountId?: number;
}

interface AgentForksOptions {
  includePrivateForAccountId?: number;
}

interface AgentVersionFields {
  a2aProtocolVersion?: string | null;
  avatar?: string | null;
  category?: string | null;
  changelog?: string | null;
  config?: Record<string, unknown>;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  description?: string;
  documentationUrl?: string | null;
  editorData?: Record<string, unknown>;
  extensions?: Array<Record<string, unknown>>;
  hasPushNotifications?: boolean;
  hasStateTransitionHistory?: boolean;
  hasStreaming?: boolean;
  interfaces?: Array<Record<string, unknown>>;
  name?: string;
  preferredTransport?: string | null;
  securityRequirements?: Array<Record<string, unknown>>;
  securitySchemes?: Record<string, unknown>;
  summary?: string;
  supportsAuthenticatedExtendedCard?: boolean;
  tags?: string[];
  tokenUsage?: number;
  url?: string | null;
}

const toIso = (date: Date) => date.toISOString();

const isConcreteStatus = (
  status: AgentListQuery['status'],
): status is NonNullable<AgentListParams['status']> =>
  status === 'published' ||
  status === 'unpublished' ||
  status === 'archived' ||
  status === 'deprecated';

const isConcreteVisibility = (
  visibility: AgentListQuery['visibility'],
): visibility is NonNullable<AgentListParams['visibility']> =>
  visibility === 'public' || visibility === 'private' || visibility === 'internal';

const normalizeOwnerId = (ownerId: AgentListQuery['ownerId']) => {
  if (ownerId === undefined) return undefined;

  const parsed = typeof ownerId === 'number' ? ownerId : Number.parseInt(ownerId, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
};

const toVersionCreateFields = (
  agentId: number,
  version: string,
  versionNumber: number,
  name: string,
  data: AgentVersionFields,
): NewMarketAgentVersion => ({
  a2aProtocolVersion: data.a2aProtocolVersion,
  agentId,
  avatar: data.avatar,
  category: data.category,
  changelog: data.changelog,
  config: data.config ?? {},
  defaultInputModes: data.defaultInputModes ?? [],
  defaultOutputModes: data.defaultOutputModes ?? [],
  description: data.description ?? '',
  documentationUrl: data.documentationUrl,
  editorData: data.editorData ?? {},
  extensions: data.extensions ?? [],
  hasPushNotifications: data.hasPushNotifications ?? false,
  hasStateTransitionHistory: data.hasStateTransitionHistory ?? false,
  hasStreaming: data.hasStreaming ?? false,
  interfaces: data.interfaces ?? [],
  isLatest: true,
  name,
  preferredTransport: data.preferredTransport,
  securityRequirements: data.securityRequirements ?? [],
  securitySchemes: data.securitySchemes ?? {},
  summary: data.summary ?? '',
  supportsAuthenticatedExtendedCard: data.supportsAuthenticatedExtendedCard ?? false,
  tags: data.tags ?? [],
  tokenUsage: data.tokenUsage ?? 0,
  url: data.url,
  version,
  versionNumber,
});

const toVersionUpdateFields = (data: AgentVersionFields): Partial<NewMarketAgentVersion> => ({
  a2aProtocolVersion: data.a2aProtocolVersion,
  avatar: data.avatar,
  category: data.category,
  changelog: data.changelog,
  config: data.config,
  defaultInputModes: data.defaultInputModes,
  defaultOutputModes: data.defaultOutputModes,
  description: data.description,
  documentationUrl: data.documentationUrl,
  editorData: data.editorData,
  extensions: data.extensions,
  hasPushNotifications: data.hasPushNotifications,
  hasStateTransitionHistory: data.hasStateTransitionHistory,
  hasStreaming: data.hasStreaming,
  interfaces: data.interfaces,
  name: data.name,
  preferredTransport: data.preferredTransport,
  securityRequirements: data.securityRequirements,
  securitySchemes: data.securitySchemes,
  summary: data.summary,
  supportsAuthenticatedExtendedCard: data.supportsAuthenticatedExtendedCard,
  tags: data.tags,
  tokenUsage: data.tokenUsage,
  url: data.url,
});

const toCreateResponse = (agent: MarketAgentItem): AgentCreateResponse => ({
  createdAt: toIso(agent.createdAt),
  id: agent.id,
  identifier: agent.identifier,
  name: agent.name,
  ownerId: agent.ownerId,
  updatedAt: toIso(agent.updatedAt),
});

const toModifyResponse = (agent: MarketAgentItem): AgentModifyResponse => ({
  createdAt: toIso(agent.createdAt),
  homepage: agent.homepage,
  id: agent.id,
  identifier: agent.identifier,
  isFeatured: agent.isFeatured,
  isOfficial: agent.isOfficial,
  name: agent.name,
  ownerId: agent.ownerId,
  status: agent.status,
  updatedAt: toIso(agent.updatedAt),
  visibility: agent.visibility,
});

const toVersionResponse = (
  version: MarketAgentVersionItem,
): AgentVersionCreateResponse | AgentVersionModifyResponse => ({
  agentId: version.agentId,
  createdAt: toIso(version.createdAt),
  description: version.description,
  id: version.id,
  isLatest: version.isLatest,
  name: version.name,
  updatedAt: toIso(version.updatedAt),
  version: version.version,
  versionNumber: version.versionNumber,
});

const toAgentListItem = (agent: MarketAgentItem, version: MarketAgentVersionItem) => ({
  avatar: version.avatar ?? '',
  category: version.category ?? undefined,
  createdAt: toIso(agent.createdAt),
  description: version.description,
  homepage: agent.homepage ?? undefined,
  icon: version.avatar ?? undefined,
  id: agent.id,
  identifier: agent.identifier,
  installCount: agent.installCount,
  isFeatured: agent.isFeatured,
  isOfficial: agent.isOfficial,
  manifestUrl: version.url ?? '',
  name: agent.name,
  ownerId: agent.ownerId,
  ratingCount: agent.ratingCount,
  status: agent.status,
  summary: version.summary,
  tags: version.tags ?? [],
  tokenUsage: version.tokenUsage,
  updatedAt: toIso(agent.updatedAt),
  version: version.version,
  versionNumber: version.versionNumber,
  visibility: agent.visibility,
});

const toAgentDetail = (
  agent: MarketAgentItem,
  version: MarketAgentVersionItem,
): AgentItemDetail => ({
  ...toAgentListItem(agent, version),
  a2aProtocolVersion: version.a2aProtocolVersion ?? undefined,
  avatar: version.avatar ?? '',
  config: version.config ?? {},
  currentVersionId: agent.currentVersionId ?? undefined,
  documentationUrl: version.documentationUrl ?? undefined,
  editorData: version.editorData ?? {},
  extensions: version.extensions ?? [],
  hasPushNotifications: version.hasPushNotifications ?? false,
  hasStateTransitionHistory: version.hasStateTransitionHistory ?? false,
  hasStreaming: version.hasStreaming ?? false,
  interfaces: version.interfaces ?? [],
  preferredTransport: version.preferredTransport ?? undefined,
  securityRequirements: version.securityRequirements ?? [],
  securitySchemes: version.securitySchemes ?? {},
  supportsAuthenticatedExtendedCard: version.supportsAuthenticatedExtendedCard ?? false,
});

const toForkItem = (agent: MarketAgentItem): AgentForkItem => ({
  createdAt: toIso(agent.createdAt),
  forkCount: agent.forkCount,
  id: agent.id,
  identifier: agent.identifier,
  name: agent.name,
  ownerId: agent.ownerId,
});

const toIdentifierItem = (item: { id: string; lastModified: Date }) => ({
  id: item.id,
  lastModified: toIso(item.lastModified),
});

export class AgentService {
  private readonly model: AgentModel;

  constructor(db: MarketDatabase) {
    this.model = new AgentModel(db);
  }

  async createAgent(ownerId: number, data: AgentCreateRequest): Promise<AgentCreateResponse> {
    const existing = await this.model.findByIdentifier(data.identifier);
    if (existing) {
      throw new MarketHttpError(
        409,
        'agent_identifier_exists',
        'An agent with this identifier already exists.',
      );
    }

    const agent = await this.model.createAgent({
      homepage: data.homepage,
      identifier: data.identifier,
      isFeatured: data.isFeatured ?? false,
      name: data.name,
      ownerId,
      status: data.status ?? 'unpublished',
      visibility: data.visibility ?? 'public',
    });

    return toCreateResponse(agent);
  }

  async modifyAgent(ownerId: number, data: AgentModifyRequest): Promise<AgentModifyResponse> {
    await this.requireOwnedAgent(ownerId, data.identifier);

    const values: Partial<NewMarketAgent> = {
      homepage: data.homepage,
      isFeatured: data.isFeatured,
      isOfficial: data.isOfficial,
      name: data.name,
      status: data.status,
      visibility: data.visibility,
    };
    const agent = await this.model.updateAgent(data.identifier, values);
    if (!agent) throw new MarketHttpError(404, 'agent_not_found', 'Agent not found.');

    return toModifyResponse(agent);
  }

  async createAgentVersion(
    ownerId: number,
    data: AgentVersionCreateRequest,
  ): Promise<AgentVersionCreateResponse> {
    const agent = await this.requireOwnedAgent(ownerId, data.identifier);
    const versionNumber = data.versionNumber ?? (await this.model.getNextVersionNumber(agent.id));
    const versionString = data.version ?? `1.0.${versionNumber - 1}`;
    const version = await this.model.createVersion(
      toVersionCreateFields(agent.id, versionString, versionNumber, data.name ?? agent.name, data),
    );

    return toVersionResponse(version);
  }

  async modifyAgentVersion(
    ownerId: number,
    data: AgentVersionModifyRequest,
  ): Promise<AgentVersionModifyResponse> {
    const agent = await this.requireOwnedAgent(ownerId, data.identifier);
    const existingVersion = await this.model.findVersionByVersionString(agent.id, data.version);
    if (!existingVersion)
      throw new MarketHttpError(404, 'agent_version_not_found', 'Agent version not found.');

    const version = await this.model.updateVersion(existingVersion.id, {
      ...toVersionUpdateFields(data),
      name: data.name,
      version: data.versionString,
    });
    if (!version)
      throw new MarketHttpError(404, 'agent_version_not_found', 'Agent version not found.');

    return toVersionResponse(version);
  }

  async getAgentDetail(
    identifier: string,
    options: AgentDetailOptions = {},
  ): Promise<AgentItemDetail> {
    const agent = await this.model.findByIdentifier(identifier);
    if (!agent || !this.canReadAgent(agent, options.includePrivateForAccountId)) {
      throw new MarketHttpError(404, 'agent_not_found', 'Agent not found.');
    }

    const version = await this.model.findLatestVersion(agent.id);
    if (!version)
      throw new MarketHttpError(404, 'agent_version_not_found', 'Agent version not found.');

    return toAgentDetail(agent, version);
  }

  async listAgents(params: AgentListQuery = {}): Promise<AgentListResponse> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const ownerId = normalizeOwnerId(params.ownerId);
    if (
      ownerId === undefined &&
      (params.visibility === 'private' || params.visibility === 'internal')
    ) {
      return {
        currentPage: page,
        items: [],
        pageSize,
        totalCount: 0,
        totalPages: 0,
      };
    }

    const listParams: AgentListParams = {
      includePrivateForOwnerId: ownerId,
      order: params.order,
      ownerId,
      page,
      pageSize,
      query: params.q,
      status: isConcreteStatus(params.status) ? params.status : undefined,
      visibility:
        ownerId !== undefined && isConcreteVisibility(params.visibility)
          ? params.visibility
          : undefined,
    };
    const { items, totalCount } = await this.model.list(listParams);

    return {
      currentPage: page,
      items: items.flatMap(({ agent, version }) =>
        version ? [toAgentListItem(agent, version)] : [],
      ),
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    };
  }

  async listIdentifiers() {
    const identifiers = await this.model.listIdentifiers();

    return identifiers.map(toIdentifierItem);
  }

  async listCategories() {
    return await this.model.listCategories();
  }

  async listAgentsByPlugin(params: AgentListQuery = {}) {
    return await this.listAgents(params);
  }

  async forkAgent(
    ownerId: number,
    sourceIdentifier: string,
    data: AgentForkRequest,
  ): Promise<AgentForkResponse> {
    const sourceAgent = await this.model.findByIdentifier(sourceIdentifier);
    if (!sourceAgent || !this.canReadAgent(sourceAgent)) {
      throw new MarketHttpError(404, 'agent_not_found', 'Agent not found.');
    }

    const sourceVersion = await this.model.findLatestVersion(sourceAgent.id);
    if (!sourceVersion)
      throw new MarketHttpError(404, 'agent_version_not_found', 'Agent version not found.');

    const existing = await this.model.findByIdentifier(data.identifier);
    if (existing) {
      throw new MarketHttpError(
        409,
        'agent_identifier_exists',
        'An agent with this identifier already exists.',
      );
    }

    const forkName = data.name ?? sourceVersion.name;
    const agent = await this.model.createAgent({
      forkedFromAgentId: sourceAgent.id,
      identifier: data.identifier,
      name: forkName,
      ownerId,
      status: data.status ?? 'unpublished',
      visibility: data.visibility ?? 'private',
    });
    const versionNumber = data.versionNumber ?? 1;
    const version = await this.model.createVersion({
      a2aProtocolVersion: sourceVersion.a2aProtocolVersion,
      agentId: agent.id,
      avatar: sourceVersion.avatar,
      category: sourceVersion.category,
      changelog: sourceVersion.changelog,
      config: sourceVersion.config ?? {},
      defaultInputModes: sourceVersion.defaultInputModes ?? [],
      defaultOutputModes: sourceVersion.defaultOutputModes ?? [],
      description: sourceVersion.description,
      documentationUrl: sourceVersion.documentationUrl,
      editorData: sourceVersion.editorData ?? {},
      extensions: sourceVersion.extensions ?? [],
      hasPushNotifications: sourceVersion.hasPushNotifications ?? false,
      hasStateTransitionHistory: sourceVersion.hasStateTransitionHistory ?? false,
      hasStreaming: sourceVersion.hasStreaming ?? false,
      interfaces: sourceVersion.interfaces ?? [],
      isLatest: true,
      name: forkName,
      preferredTransport: sourceVersion.preferredTransport,
      securityRequirements: sourceVersion.securityRequirements ?? [],
      securitySchemes: sourceVersion.securitySchemes ?? {},
      summary: sourceVersion.summary,
      supportsAuthenticatedExtendedCard: sourceVersion.supportsAuthenticatedExtendedCard ?? false,
      tags: sourceVersion.tags ?? [],
      tokenUsage: sourceVersion.tokenUsage,
      url: sourceVersion.url,
      version: sourceVersion.version,
      versionNumber,
    });

    return {
      agent: {
        createdAt: toIso(agent.createdAt),
        forkedFromAgentId: sourceAgent.id,
        id: agent.id,
        identifier: agent.identifier,
        name: agent.name,
        ownerId: agent.ownerId,
        updatedAt: toIso(agent.updatedAt),
      },
      source: {
        agentId: sourceAgent.id,
        identifier: sourceAgent.identifier,
        versionNumber: sourceVersion.versionNumber,
      },
      version: {
        agentId: version.agentId,
        createdAt: toIso(version.createdAt),
        id: version.id,
        versionNumber: version.versionNumber,
      },
    };
  }

  async listForks(
    identifier: string,
    options: AgentForksOptions = {},
  ): Promise<AgentForksResponse> {
    const agent = await this.model.findByIdentifier(identifier);
    if (!agent || !this.canReadAgent(agent, options.includePrivateForAccountId)) {
      throw new MarketHttpError(404, 'agent_not_found', 'Agent not found.');
    }

    const forks = await this.model.listForks(agent.id, options.includePrivateForAccountId);

    return {
      forks: forks.map(toForkItem),
      totalCount: forks.length,
    };
  }

  async getForkSource(
    identifier: string,
    options: AgentForksOptions = {},
  ): Promise<AgentForkSourceResponse> {
    const agent = await this.model.findByIdentifier(identifier);
    if (!agent || !this.canReadAgent(agent, options.includePrivateForAccountId)) {
      throw new MarketHttpError(404, 'agent_not_found', 'Agent not found.');
    }
    if (!agent.forkedFromAgentId) return { source: null };

    const source = await this.model.findById(agent.forkedFromAgentId);
    if (source && !this.canReadAgent(source, options.includePrivateForAccountId)) {
      return { source: null };
    }

    return { source: source ? toForkItem(source) : null };
  }

  async increaseInstallCount(identifier: string): Promise<AgentInstallCountResponse> {
    const agent = await this.model.increaseInstallCount(identifier);
    if (!agent) throw new MarketHttpError(404, 'agent_not_found', 'Agent not found.');

    return {
      identifier: agent.identifier,
      installCount: agent.installCount,
      success: true,
    };
  }

  async createEvent(accountId: number | null, data: AgentEventRequest) {
    const agent = await this.model.findByIdentifier(data.identifier);
    if (!agent) throw new MarketHttpError(404, 'agent_not_found', 'Agent not found.');

    return await this.model.createEvent({
      accountId,
      agentId: agent.id,
      event: data.event,
      source: data.source,
    });
  }

  private async requireOwnedAgent(ownerId: number, identifier: string) {
    const agent = await this.model.findByIdentifier(identifier);
    if (!agent) throw new MarketHttpError(404, 'agent_not_found', 'Agent not found.');
    if (agent.ownerId !== ownerId) {
      throw new MarketHttpError(403, 'agent_forbidden', 'Only the agent owner can mutate it.');
    }

    return agent;
  }

  private canReadAgent(agent: MarketAgentItem, accountId?: number) {
    return agent.visibility === 'public' || agent.ownerId === accountId;
  }
}

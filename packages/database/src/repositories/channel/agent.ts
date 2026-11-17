import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { isHeterogeneousAgentModelId } from '@lobechat/const';
import type {
  ChannelExecutionConfig,
  ChannelMemberConfig,
  ChannelSharedAgentAccess,
  LobeAgentConfig,
} from '@lobechat/types';
import { agentDisplayName, isChannelRuntime } from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';
import { and, eq, ne } from 'drizzle-orm';
import type { PartialDeep } from 'type-fest';

import type { ChannelItem, ChannelMemberItem } from '../../schemas';
import { agents, agentShares, channelMembers, userSettings } from '../../schemas';
import type { Transaction } from '../../type';
import { agentUsableByWhere } from '../../utils/agent-access';
import { mergeAgentDefaultConfig } from '../../utils/agentConfig';
import { normalizeInboxAgentTitle } from '../../utils/inboxAgent';
import { notTrashed } from '../../utils/softDelete';
import { ChannelError } from './error';

/**
 * Whether a direct conversation is with an Agent reached through its share: someone else's Agent
 * this scope does not hold. A workspace colleague's public Agent is the workspace's own.
 */
export const isSharedAgentChannel = (
  channel: Pick<ChannelItem, 'agentId' | 'workspaceId'>,
  agent: {
    agentOwnerId: string | null;
    agentVisibility: string | null;
    agentWorkspaceId: string | null;
  },
  viewerId: string,
): boolean =>
  !!channel.agentId &&
  agent.agentOwnerId !== viewerId &&
  !(
    channel.workspaceId &&
    agent.agentWorkspaceId === channel.workspaceId &&
    agent.agentVisibility !== 'private'
  );

/** Explicitly select environment fields so legacy or untyped copies cannot override an Agent. */
export const memberEnvironment = (config?: ChannelMemberConfig | null): ChannelMemberConfig =>
  cleanObject({
    deviceId: config?.deviceId,
    deviceOwnerId: config?.deviceOwnerId,
    workingDirectory: config?.workingDirectory,
  });

export interface ChannelAddAgentInput {
  agentId: string;
  config?: ChannelMemberConfig;
  /** Optional Channel-specific routing description and identity label. */
  description?: string;
  name?: string;
}

/**
 * Another person's Agent that `userId` may talk to through its live link share. A link share is
 * open to anyone signed in, so no contact entry is needed; only a direct conversation (personal
 * or in a workspace) can hold one, because the share admits one person at a time and counts its
 * limits per person.
 */
export const findSharedChannelAgent = async (
  tx: Transaction,
  userId: string,
  agentId: string,
): Promise<
  (ChannelSharedAgentAccess & { name: string | null; title: string | null }) | undefined
> => {
  const [row] = await tx
    .select({
      name: agents.name,
      ownerId: agents.userId,
      shareId: agentShares.id,
      slug: agents.slug,
      title: agents.title,
      workspaceId: agents.workspaceId,
    })
    .from(agents)
    .innerJoin(agentShares, eq(agentShares.agentId, agents.id))
    .where(
      and(
        eq(agents.id, agentId),
        eq(agentShares.visibility, 'link'),
        notTrashed(agents.isDeleted),
        ne(agents.userId, userId),
      ),
    )
    .for('share', { of: agents });
  if (!row?.ownerId) return undefined;
  return {
    name: row.name,
    ownerId: row.ownerId,
    shareId: row.shareId,
    title: normalizeInboxAgentTitle(row.title, row),
    workspaceId: row.workspaceId,
  };
};

/**
 * Whether a direct conversation may bind another person's Agent through its share. A direct
 * conversation has one person in any scope, so a workspace one can hold it as well.
 */
const acceptsSharedAgent = (channel: Pick<ChannelItem, 'agentId'>, agentId: string) =>
  channel.agentId === agentId;

/** Check Agent scope and hold it through creation of the Channel/member reference. */
export const requireChannelAgent = async (
  tx: Transaction,
  workspaceId: string | null,
  userId: string,
  agentId: string,
  options: { allowShared?: boolean } = {},
) => {
  const [agent] = await tx
    .select({ name: agents.name, slug: agents.slug, title: agents.title })
    .from(agents)
    .where(agentUsableByWhere(agentId, { userId, workspaceId: workspaceId ?? undefined }))
    .for('share');
  if (agent)
    // LobeAI rows are stored without a title; label it the way the rest of the product does.
    return { name: agent.name, title: normalizeInboxAgentTitle(agent.title, agent) };
  const shared = options.allowShared
    ? await findSharedChannelAgent(tx, userId, agentId)
    : undefined;
  if (!shared) throw new ChannelError('NOT_FOUND', 'Agent not found');
  return { name: shared.name, title: shared.title };
};

/** Called under the Channel lock after the caller's admin role has been checked. */
export const addAgentMember = async (
  tx: Transaction,
  channel: ChannelItem,
  userId: string,
  input: ChannelAddAgentInput,
): Promise<ChannelMemberItem> => {
  if (channel.peerUserId)
    throw new ChannelError('BAD_REQUEST', 'A conversation between two people has no Agents');
  if (channel.agentId) {
    if (input.agentId !== channel.agentId)
      throw new ChannelError('BAD_REQUEST', 'A direct conversation is bound to one Agent');
    const [existing] = await tx
      .select({ id: channelMembers.id })
      .from(channelMembers)
      .where(and(eq(channelMembers.channelId, channel.id), eq(channelMembers.actorType, 'agent')));
    if (existing)
      throw new ChannelError('CONFLICT', 'The direct conversation already has its Agent');
  }
  if (!input.agentId.trim())
    throw new ChannelError('BAD_REQUEST', 'An Agent reference is required');
  const agent = await requireChannelAgent(tx, channel.workspaceId, userId, input.agentId, {
    allowShared: acceptsSharedAgent(channel, input.agentId),
  });
  // Idempotent per Agent: retrying a partly applied batch must not add a second member that
  // answers the same requests again.
  const [joined] = await tx
    .select()
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, channel.id),
        eq(channelMembers.agentId, input.agentId),
        eq(channelMembers.status, 'active'),
      ),
    )
    .limit(1);
  if (joined) return joined;
  const [member] = await tx
    .insert(channelMembers)
    .values({
      actorType: 'agent',
      agentId: input.agentId,
      channelId: channel.id,
      config: memberEnvironment(input.config),
      description: input.description,
      name: input.name?.trim() || agentDisplayName(agent, 'Agent'),
    })
    .returning();
  return member;
};

/** An active Agent member of this Channel; people and departed Agents have no environment. */
export const requireAgentMember = async (tx: Transaction, channelId: string, memberId: string) => {
  const [member] = await tx
    .select()
    .from(channelMembers)
    .where(
      and(
        eq(channelMembers.channelId, channelId),
        eq(channelMembers.id, memberId),
        eq(channelMembers.actorType, 'agent'),
        eq(channelMembers.status, 'active'),
      ),
    )
    .limit(1);
  if (!member?.agentId) throw new ChannelError('NOT_FOUND', 'Agent member not found');
  return member as ChannelMemberItem & { agentId: string };
};

const agentSettingsColumns = {
  agencyConfig: agents.agencyConfig,
  avatar: agents.avatar,
  backgroundColor: agents.backgroundColor,
  chatConfig: agents.chatConfig,
  editorData: agents.editorData,
  fewShots: agents.fewShots,
  model: agents.model,
  name: agents.name,
  openingMessage: agents.openingMessage,
  openingQuestions: agents.openingQuestions,
  params: agents.params,
  plugins: agents.plugins,
  profile: agents.profile,
  provider: agents.provider,
  systemRole: agents.systemRole,
  title: agents.title,
  tts: agents.tts,
  virtual: agents.virtual,
};

/** Read current settings with the requester's Agent permissions, then freeze the effective config. */
export const resolveExecutionConfig = async (
  tx: Transaction,
  channel: ChannelItem,
  member: ChannelMemberItem,
  userId: string,
  serverDefault: PartialDeep<LobeAgentConfig>,
): Promise<ChannelExecutionConfig | null> => {
  if (!member.agentId) return null;
  const [agent] = await tx
    .select(agentSettingsColumns)
    .from(agents)
    .where(
      agentUsableByWhere(member.agentId, { userId, workspaceId: channel.workspaceId ?? undefined }),
    )
    .for('share');
  if (agent) {
    const config = await mergeDefaults(tx, agent, userId, channel.workspaceId, serverDefault);
    const runtime = agentRuntime(config);
    if (!isChannelRuntime(runtime)) return null;
    return {
      ...config,
      ...memberEnvironment(member.config),
      provider: config.provider || DEFAULT_PROVIDER,
      runtime,
    };
  }

  // Someone else's Agent: it runs as its owner, in its own scope, with the owner's defaults —
  // exactly what a visitor of its share page gets — and only in the cloud.
  if (!acceptsSharedAgent(channel, member.agentId)) return null;
  const share = await findSharedChannelAgent(tx, userId, member.agentId);
  if (!share) return null;
  const [owned] = await tx
    .select(agentSettingsColumns)
    .from(agents)
    .where(eq(agents.id, member.agentId))
    .for('share');
  if (!owned) return null;
  const config = await mergeDefaults(tx, owned, share.ownerId, share.workspaceId, serverDefault);
  if (agentRuntime(config) !== 'native') return null;
  return {
    ...config,
    provider: config.provider || DEFAULT_PROVIDER,
    runtime: 'native',
    share: { ownerId: share.ownerId, shareId: share.shareId, workspaceId: share.workspaceId },
  };
};

// Match ordinary Agent execution, including Agents created before agencyConfig existed.
const agentRuntime = (config: LobeAgentConfig) =>
  config.agencyConfig?.heterogeneousProvider?.type ??
  (isHeterogeneousAgentModelId(config.model) ? config.model : 'native');

/** System, server and (personal scope only) the runner's own defaults, then the Agent. */
const mergeDefaults = async (
  tx: Transaction,
  agent: Record<string, unknown>,
  userId: string,
  workspaceId: string | null,
  serverDefault: PartialDeep<LobeAgentConfig>,
) => {
  const [settings] = workspaceId
    ? []
    : await tx
        .select({ defaultAgent: userSettings.defaultAgent })
        .from(userSettings)
        .where(eq(userSettings.id, userId));
  return mergeAgentDefaultConfig(agent, {
    serverDefault,
    userDefault: settings?.defaultAgent,
    workspaceId,
  });
};

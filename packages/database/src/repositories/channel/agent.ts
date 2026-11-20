import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import { isAgentShareVisitorHeteroType, isHeterogeneousAgentModelId } from '@lobechat/const';
import type {
  ChannelExecutionConfig,
  ChannelMemberConfig,
  ChannelSharedAgentAccess,
  ContactUserProfile,
  LobeAgentConfig,
} from '@lobechat/types';
import { agentDisplayName, isChannelRuntime } from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';
import { and, eq, ne } from 'drizzle-orm';
import type { PartialDeep } from 'type-fest';

import type { ChannelItem, ChannelMemberItem } from '../../schemas';
import { agents, agentShares, channelMembers, users, userSettings } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
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

/**
 * What a listed Channel tells its viewer about another person's shared Agent it is with: that it
 * is one, and its visitor page (`/a/<handle>`), the only page of the Agent the viewer can open.
 */
export const sharedAgentFields = (
  channel: Pick<ChannelItem, 'agentId' | 'workspaceId'>,
  agent: Parameters<typeof isSharedAgentChannel>[1],
  viewerId: string,
  handle: string | null,
) => {
  const sharedAgent = isSharedAgentChannel(channel, agent, viewerId);
  return {
    sharedAgent,
    sharedAgentHandle: sharedAgent ? handle : null,
  };
};

/**
 * The owner of the Agent a direct conversation is with, when it is another person's shared Agent
 * (`isSharedAgentChannel`): the profile a refused reply's contact card shows. `null` otherwise.
 */
export const sharedAgentOwner = async (
  tx: Transaction,
  channel: Pick<ChannelItem, 'agentId' | 'workspaceId'>,
  viewerId: string,
): Promise<ContactUserProfile | null> => {
  if (!channel.agentId) return null;
  const [agent] = await tx
    .select({
      agentOwnerId: agents.userId,
      agentVisibility: agents.visibility,
      agentWorkspaceId: agents.workspaceId,
      owner: {
        avatar: users.avatar,
        fullName: users.fullName,
        id: users.id,
        username: users.username,
      },
    })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.userId))
    .where(eq(agents.id, channel.agentId));
  return agent && isSharedAgentChannel(channel, agent, viewerId) ? agent.owner : null;
};

/**
 * What a conversation view says about another person's shared Agent it is with: the same marks as
 * `list` (the composer reads them there to hide upload) and the owner's contact card.
 */
export const sharedAgentView = async (
  tx: Transaction,
  channel: Pick<ChannelItem, 'agentId' | 'workspaceId'>,
  viewerId: string,
) => {
  const owner = await sharedAgentOwner(tx, channel, viewerId);
  return { channel: { sharedAgent: !!owner }, owner };
};

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
  tx: LobeChatDatabase | Transaction,
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

/**
 * The share a member's reply runs under, resolved as {@link resolveExecutionConfig} does: only in a
 * direct conversation, and only for an Agent the requester cannot use as their own.
 */
export const channelReplyShare = async (
  db: LobeChatDatabase | Transaction,
  channel: Pick<ChannelItem, 'agentId' | 'workspaceId'>,
  agentId: string,
  userId: string,
) => {
  if (!acceptsSharedAgent(channel, agentId)) return;
  const [usable] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(agentUsableByWhere(agentId, { userId, workspaceId: channel.workspaceId ?? undefined }));
  if (usable) return;
  const share = await findSharedChannelAgent(db, userId, agentId);
  return (
    share && { ownerId: share.ownerId, shareId: share.shareId, workspaceId: share.workspaceId }
  );
};

/** Check Agent scope and hold it through creation of the Channel/member reference. */
export const requireChannelAgent = async (
  tx: Transaction,
  workspaceId: string | null,
  userId: string,
  agentId: string,
  options: { allowShared?: boolean } = {},
) => {
  const [agent] = await tx
    .select({
      name: agents.name,
      slug: agents.slug,
      title: agents.title,
      visibility: agents.visibility,
    })
    .from(agents)
    .where(agentUsableByWhere(agentId, { userId, workspaceId: workspaceId ?? undefined }))
    .for('share');
  if (agent)
    // LobeAI rows are stored without a title; label it the way the rest of the product does.
    return {
      name: agent.name,
      title: normalizeInboxAgentTitle(agent.title, agent),
      visibility: agent.visibility,
    };
  const shared = options.allowShared
    ? await findSharedChannelAgent(tx, userId, agentId)
    : undefined;
  if (!shared) throw new ChannelError('NOT_FOUND', 'Agent not found');
  return { name: shared.name, title: shared.title, visibility: null };
};

/**
 * Whether a workspace Channel may hold its owner's private Agent. Only the owner can use one, so
 * only conversations no one else can join take it: the direct conversation with it, and the
 * conversation between two of the owner's Agents. A group would show it, and its replies, to
 * every member. The personal space has no private Agents.
 */
const acceptsPrivateAgent = (
  channel: Pick<ChannelItem, 'agentId' | 'agentPairKey' | 'workspaceId'>,
  agentId: string,
) => !channel.workspaceId || channel.agentId === agentId || !!channel.agentPairKey;

/**
 * Called under the Channel lock after the caller's admin role has been checked. `inviter` is the
 * caller's own member: its person must be able to use the Agent, and the join line names it.
 */
export const addAgentMember = async (
  tx: Transaction,
  channel: ChannelItem,
  inviter: ChannelMemberItem,
  input: ChannelAddAgentInput,
): Promise<ChannelMemberItem> => {
  const { id: invitedBy, userId } = inviter;
  if (!userId) throw new ChannelError('FORBIDDEN', 'Only a person adds an Agent');
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
  if (agent.visibility === 'private' && !acceptsPrivateAgent(channel, input.agentId))
    throw new ChannelError(
      'FORBIDDEN',
      'A private Agent cannot join a workspace Channel; make it visible to the workspace first',
    );
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
      metadata: { invitedBy },
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
  // The runtimes its share page runs: Native, or a locally executed CLI runtime. The visitor picks no device;
  // the run's share gate decides whether the share grants the owner's device and routes there.
  const runtime = agentRuntime(config);
  if (
    !isChannelRuntime(runtime) ||
    (runtime !== 'native' && !isAgentShareVisitorHeteroType(runtime))
  )
    return null;
  return {
    ...config,
    provider: config.provider || DEFAULT_PROVIDER,
    runtime,
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

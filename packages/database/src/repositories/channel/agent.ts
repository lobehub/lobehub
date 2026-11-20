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
import { and, eq, ne, sql } from 'drizzle-orm';
import type { PartialDeep } from 'type-fest';

import type { ChannelItem, ChannelMemberItem } from '../../schemas';
import { agents, agentShares, channelMembers, users, userSettings } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { agentsNotUsableByWhere, agentUsableByWhere } from '../../utils/agent-access';
import { mergeAgentDefaultConfig } from '../../utils/agentConfig';
import { normalizeInboxAgentTitle } from '../../utils/inboxAgent';
import { notTrashed } from '../../utils/softDelete';
import { ChannelError } from './error';

/**
 * A link share that is open to `userId`: shared by someone else, for an Agent not in the trash.
 * Anyone signed in may talk to the Agent through it, so no contact entry is needed.
 */
const liveLinkShareWhere = (userId: string) =>
  and(eq(agentShares.visibility, 'link'), notTrashed(agents.isDeleted), ne(agents.userId, userId));

/** Another person's Agent a direct conversation reaches through its live link share. */
export interface SharedChannelAgent extends ChannelSharedAgentAccess {
  /** Its visitor page (`/a/<handle>`): the share's custom slug, else the share id. */
  handle: string;
  /** The profile a refused reply's contact card shows. */
  owner: ContactUserProfile;
}

/**
 * The one rule for whether a direct conversation is with another person's shared Agent, read by
 * the list, the conversation view, send and the reply opener: its Agent is one the viewer cannot
 * use as their own (`agentUsableByWhere`, so a colleague's public workspace Agent is the
 * workspace's own) and that has a live link share. A paused or deleted share, or a trashed Agent,
 * ends it, exactly as it ends the reply (`resolveExecutionConfig`).
 *
 * Batched for the list: one query per scope, whatever the number of Channels.
 * Returns the shared Agent by Channel id; a Channel absent from the map is not with one.
 */
export const sharedChannelAgents = async (
  db: LobeChatDatabase | Transaction,
  channels: Pick<ChannelItem, 'agentId' | 'id' | 'workspaceId'>[],
  viewerId: string,
): Promise<Map<string, SharedChannelAgent>> => {
  const result = new Map<string, SharedChannelAgent>();
  const agentIdsOf = new Map<string | null, Set<string>>();
  for (const { agentId, workspaceId } of channels) {
    if (!agentId) continue;
    const ids = agentIdsOf.get(workspaceId) ?? new Set();
    ids.add(agentId);
    agentIdsOf.set(workspaceId, ids);
  }

  // One statement per scope, so the "usable as own" exclusion and the share lookup read the same
  // snapshot of the Agent's visibility.
  const sharedOf = new Map<string | null, Map<string, SharedChannelAgent>>();
  for (const [workspaceId, ids] of agentIdsOf) {
    const rows = await db
      .select({
        agentId: agents.id,
        owner: {
          avatar: users.avatar,
          fullName: users.fullName,
          id: users.id,
          username: users.username,
        },
        shareId: agentShares.id,
        slug: sql<string | null>`${agentShares.shareConfig} ->> 'slug'`,
        workspaceId: agents.workspaceId,
      })
      .from(agents)
      .innerJoin(agentShares, eq(agentShares.agentId, agents.id))
      .innerJoin(users, eq(users.id, agents.userId))
      .where(
        and(
          liveLinkShareWhere(viewerId),
          agentsNotUsableByWhere([...ids], {
            userId: viewerId,
            workspaceId: workspaceId ?? undefined,
          }),
        ),
      );
    sharedOf.set(
      workspaceId,
      new Map(
        rows.map(({ agentId, owner, shareId, slug, workspaceId: agentWorkspaceId }) => [
          agentId,
          {
            handle: slug ?? shareId,
            owner,
            ownerId: owner.id,
            shareId,
            workspaceId: agentWorkspaceId,
          },
        ]),
      ),
    );
  }

  for (const { agentId, id, workspaceId } of channels) {
    const shared = agentId && sharedOf.get(workspaceId)?.get(agentId);
    if (shared) result.set(id, shared);
  }
  return result;
};

/** {@link sharedChannelAgents} for one Channel. */
export const sharedChannelAgent = async (
  db: LobeChatDatabase | Transaction,
  channel: Pick<ChannelItem, 'agentId' | 'id' | 'workspaceId'>,
  viewerId: string,
) => (await sharedChannelAgents(db, [channel], viewerId)).get(channel.id);

/**
 * What a conversation view says about another person's shared Agent it is with: the same mark as
 * `list` (the composer reads it there to hide upload) and the owner's contact card.
 */
export const sharedAgentView = async (
  tx: Transaction,
  channel: Pick<ChannelItem, 'agentId' | 'id' | 'workspaceId'>,
  viewerId: string,
) => {
  const shared = await sharedChannelAgent(tx, channel, viewerId);
  return { channel: { sharedAgent: !!shared }, owner: shared?.owner ?? null };
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
 * Another person's Agent that `userId` may talk to through its live link share, locked for the
 * caller's write. Only a direct conversation (personal or in a workspace) can hold one, because
 * the share admits one person at a time and counts its limits per person. Callers check
 * `agentUsableByWhere` first, as {@link sharedChannelAgents} does.
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
    .where(and(eq(agents.id, agentId), liveLinkShareWhere(userId)))
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
 * The share a member's reply runs under: only in a direct conversation, and only for the Agent
 * {@link sharedChannelAgents} marks as shared there, so the list and the reply never disagree.
 */
export const channelReplyShare = async (
  db: LobeChatDatabase | Transaction,
  channel: Pick<ChannelItem, 'agentId' | 'id' | 'workspaceId'>,
  agentId: string,
  userId: string,
): Promise<ChannelSharedAgentAccess | undefined> => {
  if (!acceptsSharedAgent(channel, agentId)) return;
  const share = await sharedChannelAgent(db, channel, userId);
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

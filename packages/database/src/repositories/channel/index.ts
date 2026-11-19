import type {
  ChannelAvatarMember,
  ChannelLastMessage,
  ChannelMemberConfig,
  ChannelMemberRole,
  ChannelReplyJob,
  ChannelThreadMention,
  ChannelVisibility,
} from '@lobechat/types';
import { agentDisplayName } from '@lobechat/types';
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { TrashModel } from '../../models/trash';
import type { ChannelItem, ChannelJobItem, ChannelMessageItem } from '../../schemas';
import {
  agents,
  agentShares,
  channelJobs,
  channelMembers,
  channelMessages,
  channels,
  channelThreads,
  workspaceMembers,
} from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { agentTitleSql } from '../../utils/inboxAgent';
import { notTrashed, trashStamp } from '../../utils/softDelete';
import { normalizeWorkspaceId } from '../../utils/workspace';
import type { ChannelAddAgentInput } from './agent';
import {
  addAgentMember,
  isSharedAgentChannel,
  memberEnvironment,
  requireAgentMember,
  requireChannelAgent,
  sharedAgentOwner,
} from './agent';
import { openAgentPair } from './agentPair';
import { channelAvatarMembers } from './avatars';
import { deleteMessage } from './delete';
import { findThread } from './delivery';
import { editMessage } from './edit';
import { ChannelError } from './error';
import { channelLastMessages } from './lastMessage';
import { leaveChannel, removeChannelMember } from './membership';
import { setMemberMuted } from './mute';
import { findPeer, lockPeerPair, peerOf, requirePeerRelation } from './peer';
import { addChannelUser, channelUserCandidates, newChannelUserCandidates } from './people';
import type { ChannelAgentPostInput } from './post';
import { postAgentMessage } from './post';
import {
  findOpenChannel,
  joinOpenChannel,
  listUnjoinedOpenChannels,
  readOpenChannel,
} from './projectAccess';
import { joinPublicChannel, listJoinableChannels } from './publicAccess';
import { retryJob } from './retry';
import { retryRouting } from './routing';
import { type ChannelSearchOptions, searchChannelMessages } from './search';
import { ChannelSectionRepository } from './sections';
import type { ChannelSendInput } from './send';
import { sendMessage } from './send';
import type { ChannelStopScope } from './stop';
import { stopScope } from './stop';
import { channelThreadMentions } from './threadMentions';
import { audit, lockChannel } from './transaction';
import type { ChannelAccess, ChannelAgentPairAccess, ChannelWriteOptions } from './types';
import { createChannelThread, readChannelView, viewerJobs } from './view';
import {
  readWakeConfig,
  replaceChannelWake,
  replaceMemberWake,
  wakeRecordScope,
  withMemberWake,
} from './wake';

export type { ChannelAddAgentInput } from './agent';
export { memberEnvironment } from './agent';
export {
  CHANNEL_ROUTING_BATCH_SIZE,
  CHANNEL_ROUTING_LEASE_MS,
  ChannelRoutingRepository,
} from './ChannelRoutingRepository';
export type {
  ChannelClaim,
  ChannelClaimOptions,
  ChannelRoutedDevice,
  ChannelRoutedDeviceInput,
} from './claim';
export type { ChannelErrorCode } from './error';
export { ChannelError } from './error';
export { ChannelExecutionRepository } from './execution';
export { ChannelHistoryRepository } from './history';
export { removeAgentFromProjectChannels } from './membership';
export type {
  ChannelCoAddressedAgent,
  ChannelOpeningCandidate,
  ChannelOpeningDecision,
} from './opening';
export type { ChannelAgentPostInput } from './post';
export type { AppliedChannelRouting, ChannelRoutingDecision } from './routing';
export { ChannelSectionRepository } from './sections';
export type { ChannelSendInput } from './send';
export type { ChannelStopScope } from './stop';
export type { ChannelAccess, ChannelAgentPairAccess, ChannelWriteOptions } from './types';
export { channelAgentPairKey } from './types';
export type { ChannelWorktreeCandidate } from './worktree';

/** Recycle-bin row title: the start of the thread's root message. */
const CHANNEL_THREAD_TITLE_LENGTH = 120;

const ROLE_RANK: Record<ChannelMemberRole, number> = { admin: 1, member: 0, owner: 2 };

const hasRole = (role: ChannelMemberRole | null, minRole: ChannelMemberRole) =>
  ROLE_RANK[role ?? 'member'] >= ROLE_RANK[minRole];

/** Workspace roles that manage every group Channel they belong to in that workspace. */
const WORKSPACE_MANAGER_ROLES = ['owner', 'admin'];

/**
 * Membership-scoped access to channels.
 *
 * A caller reaches a channel only through its own active human member row, in the current
 * scope (personal, or the given workspace). Every write runs inside `write`, which holds the
 * `channels` row lock so mutations of one channel serialize in a transaction.
 */
export class ChannelRepository {
  private readonly workspaceId: string | null;
  /** The caller's own sidebar sections in this scope. */
  readonly sections: ChannelSectionRepository;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    workspaceId?: string | null,
  ) {
    this.workspaceId = normalizeWorkspaceId(workspaceId);
    this.sections = new ChannelSectionRepository(db, userId, this.workspaceId);
  }

  /** Opens the unique direct conversation, or creates a group with its initial members. */
  create = async (params: {
    agentId?: string;
    /** The direct conversation's Agent environment; the caller resolved and checked it. */
    agentConfig?: ChannelMemberConfig;
    agents?: ChannelAddAgentInput[];
    /** Callers check that the project is readable in this scope. */
    projectId?: string;
    title: string;
    /** People a group starts with, checked the same way as adding them later. */
    userIds?: string[];
    /** The direct conversation binds another person's Agent through its live link share. */
    sharedAgent?: boolean;
    visibility?: ChannelVisibility;
  }) =>
    this.db.transaction(async (tx) => {
      const { agentId } = params;
      if (
        agentId !== undefined &&
        (!agentId.trim() ||
          params.visibility === 'public' ||
          !!params.agents?.length ||
          !!params.userIds?.length)
      )
        throw new ChannelError(
          'BAD_REQUEST',
          'A direct conversation requires an Agent and private visibility',
        );
      if (agentId) {
        // Only the service opens one with another person's shared Agent, after resolving the
        // share the person reached; a plain Agent id never does.
        await requireChannelAgent(tx, this.workspaceId, this.userId, agentId, {
          allowShared: !!params.sharedAgent,
        });
        const existing = await this.findDirect(tx, agentId);
        if (existing) return existing;
      }
      const insert = tx.insert(channels).values({
        agentId,
        projectId: params.projectId,
        userId: this.userId,
        title: params.title,
        visibility: params.visibility,
        workspaceId: this.workspaceId,
      });
      // A concurrent open of the same direct conversation wins the unique index; reuse its row.
      const [channel] = agentId
        ? await insert.onConflictDoNothing().returning()
        : await insert.returning();
      if (!channel) {
        const existing = agentId ? await this.findDirect(tx, agentId) : undefined;
        if (existing) return existing;
        throw new ChannelError('CONFLICT', 'The direct conversation is unavailable');
      }
      const member = await this.addOwner(tx, channel.id);

      if (agentId)
        await addAgentMember(tx, channel, member, { agentId, config: params.agentConfig });
      for (const agent of params.agents ?? []) await addAgentMember(tx, channel, member, agent);
      const access = { channel, member } satisfies ChannelAccess;
      for (const userId of new Set(params.userIds)) await addChannelUser(tx, access, userId);

      return access;
    });

  /**
   * Inviting into a direct conversation starts a group instead, and the direct conversation stays
   * as it is. The group holds its person and Agent, the Agent keeping its channel-local
   * environment, joined by the invited Agents and people.
   */
  createGroupFromDirect = async (
    channelId: string,
    params: { agents?: ChannelAddAgentInput[]; title: string; userIds?: string[] },
  ) =>
    this.write(
      channelId,
      async (tx, { channel: direct }) => {
        if (!direct.agentId)
          throw new ChannelError('BAD_REQUEST', 'Only a direct conversation starts a group');
        if (!params.agents?.length && !params.userIds?.length)
          throw new ChannelError('BAD_REQUEST', 'Invite at least one person or Agent');
        const [bound] = await tx
          .select()
          .from(channelMembers)
          .where(
            and(
              eq(channelMembers.channelId, direct.id),
              eq(channelMembers.agentId, direct.agentId),
              eq(channelMembers.status, 'active'),
            ),
          )
          .limit(1);
        if (!bound) throw new ChannelError('NOT_FOUND', 'Agent member not found');

        const [channel] = await tx
          .insert(channels)
          .values({ title: params.title, userId: this.userId, workspaceId: this.workspaceId })
          .returning();
        const member = await this.addOwner(tx, channel.id);
        const access = { channel, member } satisfies ChannelAccess;
        await addAgentMember(tx, channel, member, {
          agentId: direct.agentId,
          config: bound.config ?? undefined,
          description: bound.description,
          name: bound.name ?? undefined,
        });
        for (const agent of params.agents ?? []) await addAgentMember(tx, channel, member, agent);
        for (const userId of new Set(params.userIds)) await addChannelUser(tx, access, userId);
        return access;
      },
      { minRole: 'admin' },
    );

  /** Adds a usable Agent reference; a missing reference is allowed only for retained history. */
  addAgent = async (channelId: string, input: ChannelAddAgentInput) =>
    this.write(channelId, (tx, { channel, member }) => addAgentMember(tx, channel, member, input), {
      minRole: 'admin',
    });

  /** The channel-local device and directory of one Agent member. */
  agentEnvironment = async (channelId: string, memberId: string) =>
    this.write(
      channelId,
      async (tx) => {
        const member = await requireAgentMember(tx, channelId, memberId);
        // The device owner is routing data, not something the editor chooses.
        const { deviceId, workingDirectory } = memberEnvironment(member.config);
        return { agentId: member.agentId, deviceId, workingDirectory };
      },
      { minRole: 'admin' },
    );

  /**
   * Replaces one Agent member's channel-local environment. Claimed jobs keep the
   * environment frozen in their execution config; later claims use the new one.
   */
  updateAgentEnvironment = async (
    channelId: string,
    memberId: string,
    config: ChannelMemberConfig,
  ) =>
    this.write(
      channelId,
      async (tx) => {
        const current = await requireAgentMember(tx, channelId, memberId);
        const [member] = await tx
          .update(channelMembers)
          // The environment is replaced; the member's reply strategy is not part of it.
          .set({
            config: withMemberWake(
              memberEnvironment(config),
              current.config?.wake,
              current.config?.muted,
            ),
          })
          .where(eq(channelMembers.id, memberId))
          .returning();
        await audit(tx, channelId, 'member_environment_changed', memberId);
        return member;
      },
      { minRole: 'admin' },
    );

  /**
   * The channel's reply strategy and each active Agent member's own, as stored (not parsed):
   * `null` means the defaults apply. Validation belongs to the shared wake schema in the caller.
   */
  wakeConfig = async (channelId: string) =>
    this.write(channelId, (tx, { channel }) => readWakeConfig(tx, channel), { minRole: 'admin' });

  /**
   * Whose records one Agent member's wake decisions are filed under: its Agent's owner, in the
   * channel's workspace. `null` when the Agent has no owner left to file them under.
   */
  memberWakeRecordScope = async (channelId: string, memberId: string) =>
    this.write(channelId, (tx, { channel }) => wakeRecordScope(tx, channel, memberId), {
      minRole: 'admin',
    });

  /** Replaces the channel's reply strategy; `null` returns it to the defaults. */
  updateChannelWakeConfig = async (channelId: string, wake: Record<string, unknown> | null) =>
    this.write(channelId, (tx, { channel }) => replaceChannelWake(tx, channel, wake), {
      minRole: 'admin',
    });

  /**
   * Replaces one Agent member's own reply strategy over the channel's; `null` removes it. Its
   * environment is kept as it is.
   */
  updateMemberWakeConfig = async (
    channelId: string,
    memberId: string,
    wake: Record<string, unknown> | null,
  ) =>
    this.write(channelId, (tx) => replaceMemberWake(tx, channelId, memberId, wake), {
      minRole: 'admin',
    });

  rename = async (channelId: string, title: string) =>
    this.write(
      channelId,
      async (tx, { channel }) => {
        const next = title.trim();
        if (!next) throw new ChannelError('BAD_REQUEST', 'A channel name is required');
        if (next === channel.title) return channel;
        const [renamed] = await tx
          .update(channels)
          .set({ title: next })
          .where(eq(channels.id, channelId))
          .returning();
        await audit(tx, channelId, 'renamed', channelId);
        return renamed;
      },
      { minRole: 'admin' },
    );

  /**
   * Who in the workspace can find a group Channel: `public` lists it for every workspace member
   * to join, `private` only for the people already in it. Members keep their access either way.
   */
  updateVisibility = async (channelId: string, visibility: ChannelVisibility) =>
    this.write(
      channelId,
      async (tx, { channel }) => {
        if (channel.agentId || channel.peerUserId || !channel.workspaceId)
          throw new ChannelError('BAD_REQUEST', 'Only a workspace group channel can be public');
        if (channel.visibility === visibility) return channel;
        const [updated] = await tx
          .update(channels)
          .set({ visibility })
          .where(eq(channels.id, channelId))
          .returning();
        await audit(tx, channelId, 'visibility_changed', channelId, { visibility });
        return updated;
      },
      { minRole: 'admin' },
    );

  /** Public group Channels in this workspace the caller has not joined, newest first. */
  listJoinable = async (search?: string) =>
    listJoinableChannels(this.db, this.userId, this.workspaceId, search);

  /**
   * Joins a group Channel the caller can see without belonging to it, or returns their membership
   * when they already belong: an open project Channel (see {@link joinOpenChannel}), else a public
   * one of this workspace.
   */
  join = async (channelId: string): Promise<ChannelAccess> => {
    try {
      return await this.write(channelId, async (_tx, access) => access, { joinOpen: true });
    } catch (error) {
      if (!(error instanceof ChannelError) || error.code !== 'NOT_FOUND') throw error;
    }
    return joinPublicChannel(this.db, this.userId, this.workspaceId, channelId);
  };

  addUser = async (channelId: string, userId: string) =>
    this.write(channelId, (tx, access) => addChannelUser(tx, access, userId), { minRole: 'admin' });

  /** Removes a person or an Agent; returns the writers still to stop. See {@link removeChannelMember}. */
  removeMember = async (channelId: string, memberId: string): Promise<ChannelJobItem[]> =>
    this.write(channelId, (tx, access) => removeChannelMember(tx, access, memberId), {
      allowArchived: true,
      minRole: 'admin',
    });

  /**
   * The caller leaves a group Channel. See {@link leaveChannel}. `readable` says whether they can
   * still open it: only an active open project Channel stays readable without a seat.
   */
  leave = async (channelId: string): Promise<{ readable: boolean }> =>
    this.write(
      channelId,
      async (tx, access) => {
        await leaveChannel(tx, access);
        const open = await findOpenChannel(tx, this.userId, this.workspaceId, channelId);
        return { readable: !!open };
      },
      { allowArchived: true },
    );

  /** People a new Channel in this scope can start with. */
  newChannelUserCandidates = async (search?: string) =>
    this.db.transaction((tx) =>
      newChannelUserCandidates(tx, this.workspaceId, this.userId, search),
    );

  userCandidates = async (channelId: string, search?: string) =>
    this.write(channelId, (tx, access) => channelUserCandidates(tx, access, search), {
      minRole: 'admin',
    });

  /** Messages in a Channel the caller can read, its live Threads included, matching `query`. */
  searchMessages = async (channelId: string, options: ChannelSearchOptions) => {
    const access = await this.findAccess(channelId);
    return this.db.transaction(async (tx) => {
      const readable = access
        ? !access.channel.isDeleted
        : !!(await findOpenChannel(tx, this.userId, this.workspaceId, channelId));
      if (!readable) throw new ChannelError('NOT_FOUND', 'Channel not found');
      return searchChannelMessages(tx, channelId, options);
    });
  };

  detail = async (channelId: string, options?: Parameters<typeof readChannelView>[2]) => {
    if (!(await this.findAccess(channelId)))
      return readOpenChannel(this.db, this.userId, this.workspaceId, channelId, options);
    return this.write(
      channelId,
      async (tx, access) => {
        if (access.channel.isDeleted) throw new ChannelError('NOT_FOUND', 'Channel not found');
        const admin = hasRole(access.member.role, 'admin');
        const view = await readChannelView(tx, channelId, options, this.userId);
        // Same test as `list`; the composer reads it from here to hide upload.
        const sharedAgent = !!(await sharedAgentOwner(tx, access.channel, this.userId));
        return {
          channel: { ...access.channel, canDelete: admin, sharedAgent },
          joined: true,
          ...view,
          // Mirrors `stop`: the requester or an admin.
          jobs: viewerJobs(view.jobs, this.userId, (id) => admin || id === access.member.id),
        };
      },
      { allowArchived: true, allowTrashed: true },
    );
  };

  createThread = async (channelId: string, input: Parameters<typeof createChannelThread>[2]) =>
    this.write(channelId, (tx) => createChannelThread(tx, channelId, input), { joinOpen: true });

  markRead = async (channelId: string, sequence: number) =>
    this.write(
      channelId,
      async (tx, { channel, member }) => {
        const lastReadSequence = Math.max(
          member.lastReadSequence ?? 0,
          Math.min(sequence, channel.sequence),
        );
        await tx
          .update(channelMembers)
          .set({ lastReadSequence })
          .where(eq(channelMembers.id, member.id));
        return lastReadSequence;
      },
      { allowArchived: true, allowTrashed: true },
    );

  /** Pins the conversation atop the caller's own list, or unpins it; nobody else sees it. */
  setPinned = async (channelId: string, pinned: boolean) =>
    this.write(
      channelId,
      async (tx, { member }) => {
        const pinnedAt = pinned ? (member.pinnedAt ?? new Date()) : null;
        await tx.update(channelMembers).set({ pinnedAt }).where(eq(channelMembers.id, member.id));
        return pinnedAt;
      },
      { allowArchived: true, allowTrashed: true },
    );

  /**
   * Files the conversation under one of the caller's own sections, or back into its built-in
   * section with `null`; nobody else sees it.
   */
  moveToSection = async (channelId: string, sectionId: string | null) =>
    this.write(
      channelId,
      async (tx, { member }) => {
        if (sectionId) await this.sections.assertOwned(tx, sectionId);
        await tx.update(channelMembers).set({ sectionId }).where(eq(channelMembers.id, member.id));
        return sectionId;
      },
      { allowArchived: true, allowTrashed: true },
    );

  /**
   * Hides the conversation from the caller's own list, or shows it again; the next message
   * brings it back by itself.
   */
  setHidden = async (channelId: string, hidden: boolean) =>
    this.write(
      channelId,
      async (tx, { member }) => {
        await tx.update(channelMembers).set({ hidden }).where(eq(channelMembers.id, member.id));
        return hidden;
      },
      { allowArchived: true, allowTrashed: true },
    );

  /**
   * Channels the caller belongs to in the current scope, newest first. Archived ones are
   * included with their `status`, so they stay readable outside the active list. Active open
   * project Channels the caller has not joined follow with `joined: false`.
   */
  list = async (): Promise<
    Array<
      ChannelItem & {
        agentIds: string[];
        canDelete: boolean;
        /** False for an open project Channel the caller can read but has not joined. */
        joined: boolean;
        lastMessage: ChannelLastMessage | null;
        memberAvatars: ChannelAvatarMember[];
        memberRole: ChannelMemberRole | null;
        mentionCount: number;
        hidden: boolean;
        pinnedAt: Date | null;
        replyJobs: ChannelReplyJob[];
        sectionId: string | null;
        sharedAgentHandle: string | null;
        threadMentions: ChannelThreadMention[];
        unreadCount: number;
      }
    >
  > => {
    const rows = await this.db
      .select({
        agentOwnerId: agents.userId,
        agentVisibility: agents.visibility,
        agentWorkspaceId: agents.workspaceId,
        channel: channels,
        hidden: channelMembers.hidden,
        lastReadSequence: channelMembers.lastReadSequence,
        memberId: channelMembers.id,
        pinnedAt: channelMembers.pinnedAt,
        role: this.callerRole(),
        sectionId: channelMembers.sectionId,
        shareId: agentShares.id,
        shareSlug: sql<string | null>`${agentShares.shareConfig} ->> 'slug'`,
      })
      .from(channels)
      .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
      .leftJoin(agents, eq(agents.id, channels.agentId))
      .leftJoin(agentShares, eq(agentShares.agentId, channels.agentId))
      .where(and(this.membershipWhere(), notTrashed(channels.isDeleted)))
      .orderBy(desc(channels.createdAt));
    const open = await listUnjoinedOpenChannels(this.db, this.userId, this.workspaceId);
    const previewIds = [...rows.map(({ channel }) => channel.id), ...open.map(({ id }) => id)];

    const lastMessageOf = await channelLastMessages(this.db, previewIds);

    // Main-conversation replies the list row shows as in progress: ones that can still publish,
    // and stopped ones whose writer has not exited yet.
    const pending = rows.length
      ? await this.db
          .select({
            blockedCode: channelJobs.blockedCode,
            channelId: channelJobs.channelId,
            id: channelJobs.id,
            memberId: channelJobs.memberId,
            publicationRevoked: channelJobs.publicationRevoked,
            status: channelJobs.status,
            threadId: channelJobs.threadId,
            writerHeld: channelJobs.writerHeld,
          })
          .from(channelJobs)
          .where(
            and(
              inArray(
                channelJobs.channelId,
                rows.map(({ channel }) => channel.id),
              ),
              isNull(channelJobs.threadId),
              or(
                and(
                  eq(channelJobs.publicationRevoked, false),
                  inArray(channelJobs.status, ['queued', 'running']),
                ),
                and(eq(channelJobs.publicationRevoked, true), eq(channelJobs.writerHeld, true)),
              ),
            ),
          )
          .orderBy(desc(channelJobs.createdAt))
      : [];
    const replyJobsOf = new Map<string, ChannelReplyJob[]>();
    for (const { channelId, ...job } of pending) {
      const jobs = replyJobsOf.get(channelId) ?? [];
      jobs.push(job);
      replyJobsOf.set(channelId, jobs);
    }

    // Unread messages that @mention the caller, counted from the same read position as
    // `unreadCount`; only channels with unread messages are scanned.
    const unreadMemberIds = rows
      .filter(({ channel, lastReadSequence }) => channel.sequence > (lastReadSequence ?? 0))
      .map(({ memberId }) => memberId);
    const mentioned = unreadMemberIds.length
      ? await this.db
          .select({
            channelId: channelMessages.channelId,
            count: sql<number>`count(*)::int`,
          })
          .from(channelMessages)
          .innerJoin(channelMembers, eq(channelMembers.channelId, channelMessages.channelId))
          .where(
            and(
              inArray(channelMembers.id, unreadMemberIds),
              sql`${channelMessages.sequence} > coalesce(${channelMembers.lastReadSequence}, 0)`,
              sql`${channelMessages.mentions} @> jsonb_build_array(${channelMembers.id}::text)`,
            ),
          )
          .groupBy(channelMessages.channelId)
      : [];
    const mentionCountOf = new Map(mentioned.map(({ channelId, count }) => [channelId, count]));

    // Thread mentions outlive the read position, which opening the main conversation moves.
    const threadMentionsOf = await channelThreadMentions(
      this.db,
      rows.map(({ memberId }) => memberId),
    );

    // A group Channel's list avatar pictures its first members; a direct one, its Agent or the
    // other person, which also pictures a shared Agent the caller has no sidebar row for.
    const avatarsOf = await channelAvatarMembers(this.db, previewIds, this.userId);

    // Every active Agent member, so a page about one Agent can list the Channels it takes part in;
    // the avatars above are capped and leave later members out.
    const agentMembers = previewIds.length
      ? await this.db
          .select({ agentId: channelMembers.agentId, channelId: channelMembers.channelId })
          .from(channelMembers)
          .where(
            and(
              inArray(channelMembers.channelId, previewIds),
              eq(channelMembers.actorType, 'agent'),
              eq(channelMembers.status, 'active'),
              isNotNull(channelMembers.agentId),
            ),
          )
          .orderBy(channelMembers.createdAt)
      : [];
    const agentIdsOf = new Map<string, string[]>();
    for (const { agentId, channelId } of agentMembers) {
      const ids = agentIdsOf.get(channelId) ?? [];
      ids.push(agentId!);
      agentIdsOf.set(channelId, ids);
    }

    const joined = rows.map(
      ({
        channel,
        hidden,
        lastReadSequence,
        pinnedAt,
        role,
        sectionId,
        shareId,
        shareSlug,
        ...agent
      }) => {
        const sharedAgent = isSharedAgentChannel(channel, agent, this.userId);
        return {
          ...channel,
          agentIds: agentIdsOf.get(channel.id) ?? [],
          sharedAgent,
          // Its visitor page (`/a/<handle>`) is where the caller can see this Agent; it has no other.
          sharedAgentHandle: sharedAgent ? (shareSlug ?? shareId) : null,
          canDelete: hasRole(role, 'admin'),
          hidden,
          joined: true,
          lastMessage: lastMessageOf.get(channel.id) ?? null,
          memberAvatars: avatarsOf.get(channel.id) ?? [],
          memberRole: role,
          mentionCount: mentionCountOf.get(channel.id) ?? 0,
          peerUserId: peerOf(channel, this.userId),
          pinnedAt,
          replyJobs: replyJobsOf.get(channel.id) ?? [],
          sectionId,
          threadMentions: threadMentionsOf.get(channel.id) ?? [],
          unreadCount: Math.max(0, channel.sequence - (lastReadSequence ?? 0)),
        };
      },
    );
    return [
      ...joined,
      // Not joined: nothing is unread or pending for the caller yet.
      ...open.map((channel) => ({
        ...channel,
        agentIds: agentIdsOf.get(channel.id) ?? [],
        sharedAgent: false,
        sharedAgentHandle: null,
        canDelete: false,
        hidden: false,
        joined: false,
        lastMessage: lastMessageOf.get(channel.id) ?? null,
        memberAvatars: avatarsOf.get(channel.id) ?? [],
        memberRole: null,
        mentionCount: 0,
        peerUserId: peerOf(channel, this.userId),
        pinnedAt: null,
        replyJobs: [],
        sectionId: null,
        threadMentions: [],
        unreadCount: 0,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  };

  /**
   * The caller's one-on-one conversation with another person in this scope, opened by either of
   * them: with a mutual contact in the personal space, with a fellow member in a workspace. An
   * existing conversation opens as it is, trashed or not.
   */
  openPeer = (peerUserId: string, title: string): Promise<ChannelAccess> =>
    this.db.transaction(async (tx) => {
      if (peerUserId === this.userId)
        throw new ChannelError('BAD_REQUEST', 'You cannot message yourself');
      await requirePeerRelation(tx, this.workspaceId, this.userId, peerUserId);
      // No unique index keeps one conversation per pair: serialize opening it, so two people
      // opening it at once (or one twice) find the first one instead of creating a second.
      await lockPeerPair(tx, this.workspaceId, this.userId, peerUserId);
      const existing = await findPeer(tx, this.workspaceId, this.userId, peerUserId);
      if (existing) return existing;

      const [channel] = await tx
        .insert(channels)
        .values({
          peerUserId,
          title,
          userId: this.userId,
          visibility: 'private',
          workspaceId: this.workspaceId,
        })
        .returning();
      const member = await this.addOwner(tx, channel.id);
      await tx.insert(channelMembers).values({
        actorType: 'user',
        channelId: channel.id,
        lastReadSequence: 0,
        role: 'owner',
        userId: peerUserId,
      });
      return { channel, member };
    });

  /** The conversation in which one of the caller's Agents asks another. See {@link openAgentPair}. */
  openAgentPair = (params: Parameters<typeof openAgentPair>[2]): Promise<ChannelAgentPairAccess> =>
    this.db.transaction((tx) =>
      openAgentPair(tx, { userId: this.userId, workspaceId: this.workspaceId }, params),
    );

  /**
   * The caller's active Channels with their active Agent members, newest first: where the caller
   * can address another Agent. Archived and trashed Channels are left out, since nothing posted
   * there is answered.
   */
  directory = async (): Promise<
    Array<{
      agents: Array<{
        agentId: string;
        description: string | null;
        memberId: string;
        name: string;
      }>;
      channel: ChannelItem;
    }>
  > => {
    const rows = await this.db
      .select({ channel: channels })
      .from(channels)
      .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
      .where(
        and(this.membershipWhere(), notTrashed(channels.isDeleted), eq(channels.status, 'active')),
      )
      .orderBy(desc(channels.createdAt));
    if (!rows.length) return [];

    const members = await this.db
      .select({
        agentId: channelMembers.agentId,
        agentName: agents.name,
        agentTitle: agentTitleSql(),
        channelId: channelMembers.channelId,
        description: sql<
          string | null
        >`coalesce(nullif(${channelMembers.description}, ''), ${agents.description})`,
        label: channelMembers.name,
        memberId: channelMembers.id,
      })
      .from(channelMembers)
      .innerJoin(agents, eq(agents.id, channelMembers.agentId))
      .where(
        and(
          inArray(
            channelMembers.channelId,
            rows.map(({ channel }) => channel.id),
          ),
          eq(channelMembers.actorType, 'agent'),
          eq(channelMembers.status, 'active'),
        ),
      )
      .orderBy(channelMembers.createdAt);

    const agentsOf = new Map<
      string,
      Array<{ agentId: string; description: string | null; memberId: string; name: string }>
    >();
    for (const member of members) {
      const list = agentsOf.get(member.channelId) ?? [];
      list.push({
        agentId: member.agentId!,
        description: member.description,
        memberId: member.memberId,
        // The member label is how the Channel names it, and what `@Name` in a message matches.
        name:
          member.label ||
          agentDisplayName({ name: member.agentName, title: member.agentTitle }, 'Agent'),
      });
      agentsOf.set(member.channelId, list);
    }
    return rows.map(({ channel }) => ({ agents: agentsOf.get(channel.id) ?? [], channel }));
  };

  /** Read access. Returns undefined when the channel is missing or the caller is no member. */
  findAccess = async (channelId: string): Promise<ChannelAccess | undefined> => {
    const [row] = await this.db
      .select({ channel: channels, member: channelMembers })
      .from(channels)
      .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
      .where(and(eq(channels.id, channelId), this.membershipWhere()))
      .limit(1);

    return row;
  };

  /** The caller's direct conversation with an Agent in this scope, trashed or not. */
  findDirectAccess = (agentId: string): Promise<ChannelAccess | undefined> =>
    this.findDirect(this.db, agentId);

  /**
   * Runs `fn` while holding the channel row lock, after checking that the caller is an
   * active member with at least `minRole` (default `member`).
   */
  write = async <T>(
    channelId: string,
    fn: (tx: Transaction, access: ChannelAccess) => Promise<T>,
    options: ChannelWriteOptions = {},
  ): Promise<T> =>
    this.db.transaction(async (tx) => {
      await lockChannel(tx, channelId);

      // Read membership only after the lock: a removal or demotion committed by the previous
      // lock holder must be visible here, not the snapshot from before the wait.
      const [row] = await tx
        .select({ channel: channels, member: channelMembers, role: this.callerRole() })
        .from(channels)
        .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
        .where(and(eq(channels.id, channelId), this.membershipWhere()))
        .limit(1);
      let access: ChannelAccess | undefined = row && {
        channel: row.channel,
        member: { ...row.member, role: row.role },
      };
      if (!access && options.joinOpen) {
        // Joining is itself a write, so a trashed or archived Channel stays closed to newcomers.
        const open = await findOpenChannel(tx, this.userId, this.workspaceId, channelId);
        if (open) access = await joinOpenChannel(tx, open, this.userId);
      }
      if (!access) throw new ChannelError('NOT_FOUND', 'Channel not found');

      const minRole = options.minRole ?? 'member';
      if (!hasRole(access.member.role, minRole))
        throw new ChannelError('FORBIDDEN', `Requires the ${minRole} role in this channel`);
      if (access.channel.isDeleted && !options.allowTrashed)
        throw new ChannelError('CONFLICT', 'Channel is in the trash');
      if (access.channel.status === 'archived' && !options.allowArchived)
        throw new ChannelError('CONFLICT', 'Channel is archived');

      return fn(tx, access);
    });

  /**
   * Posts what an Agent member wrote outside any job into a Channel the caller belongs to.
   * See {@link postAgentMessage}.
   */
  postAgentMessage = async (
    channelId: string,
    input: ChannelAgentPostInput,
  ): Promise<ChannelMessageItem> =>
    this.write(channelId, (tx) => postAgentMessage(tx, channelId, input));

  /** Posts a message as the caller. See {@link sendMessage} for routing. */
  /** Sending into an open project Channel joins it first. */
  send = async (channelId: string, input: ChannelSendInput): Promise<ChannelMessageItem> =>
    this.write(channelId, (tx, access) => sendMessage(tx, access, input), { joinOpen: true });

  /**
   * Stops one job (its requester or an admin) or a branch: everything for admins, only the
   * caller's own requests for members. Returns the jobs whose writer is still held; the
   * caller must stop them physically.
   */
  stop = async (channelId: string, scope: ChannelStopScope): Promise<ChannelJobItem[]> =>
    this.write(
      channelId,
      async (tx, { member }) => {
        const admin = hasRole(member.role, 'admin');
        if ('jobId' in scope && !admin) {
          const [job] = await tx
            .select({ requesterMemberId: channelJobs.requesterMemberId })
            .from(channelJobs)
            .where(and(eq(channelJobs.channelId, channelId), eq(channelJobs.id, scope.jobId)));
          if (job && job.requesterMemberId !== member.id)
            throw new ChannelError('FORBIDDEN', 'Only the requester or an admin can stop this job');
        }
        return stopScope(
          tx,
          channelId,
          scope,
          'threadId' in scope && !admin ? { memberId: member.id, userId: this.userId } : undefined,
        );
      },
      { allowArchived: true, allowTrashed: true },
    );

  /**
   * Archive: keep the channel for good, readable but closed to messages and Agent work. Stops
   * everything in it like a deletion and keeps receipts until the coordinator confirms exit.
   */
  archive = async (channelId: string): Promise<ChannelJobItem[]> =>
    this.write(
      channelId,
      async (tx, { channel }) => {
        const writers = await stopScope(tx, channelId, { all: true });
        if (channel.status !== 'archived') {
          await tx.update(channels).set({ status: 'archived' }).where(eq(channels.id, channelId));
          await audit(tx, channelId, 'archived', channelId);
        }
        return writers;
      },
      { allowArchived: true, minRole: 'admin' },
    );

  /** Reopens an archived channel. Work stopped by the archive stays stopped. */
  unarchive = async (channelId: string): Promise<void> =>
    this.write(
      channelId,
      async (tx, { channel }) => {
        if (channel.status === 'active') return;
        await tx.update(channels).set({ status: 'active' }).where(eq(channels.id, channelId));
        await audit(tx, channelId, 'unarchived', channelId);
      },
      { allowArchived: true, minRole: 'admin' },
    );

  /** Archive a branch: its history stays readable, but it takes no replies and leaves Agent context. */
  archiveThread = async (channelId: string, threadId: string): Promise<ChannelJobItem[]> =>
    this.write(
      channelId,
      async (tx) => {
        const thread = await findThread(tx, channelId, threadId);
        const writers = await stopScope(tx, channelId, { threadId });
        if (thread?.status !== 'archived') {
          await tx
            .update(channelThreads)
            .set({ status: 'archived' })
            .where(eq(channelThreads.id, threadId));
          await audit(tx, channelId, 'thread_archived', threadId);
        }
        return writers;
      },
      { minRole: 'admin' },
    );

  unarchiveThread = async (channelId: string, threadId: string): Promise<void> =>
    this.write(
      channelId,
      async (tx) => {
        const thread = await findThread(tx, channelId, threadId);
        if (thread?.status === 'active') return;
        await tx
          .update(channelThreads)
          .set({ status: 'active' })
          .where(eq(channelThreads.id, threadId));
        await audit(tx, channelId, 'thread_unarchived', threadId);
      },
      { minRole: 'admin' },
    );

  /** Soft-delete under the same lock as dispatch/publication; retain receipts until exit. */
  remove = async (channelId: string): Promise<ChannelJobItem[]> =>
    this.write(
      channelId,
      async (tx, { channel }) => {
        const writers = await stopScope(tx, channelId, { all: true });
        if (!channel.isDeleted) {
          const deletedAt = new Date();
          await tx.update(channels).set(trashStamp(deletedAt)).where(eq(channels.id, channelId));
          await new TrashModel(this.db, this.userId, this.workspaceId ?? undefined).register(
            {
              deletedAt,
              root: {
                projectId: channel.projectId,
                resourceId: channel.id,
                resourceType: 'channel',
                title: channel.title,
              },
            },
            tx,
          );
          await audit(tx, channelId, 'trashed', channelId);
        }
        return writers;
      },
      { allowArchived: true, allowTrashed: true, minRole: 'admin' },
    );

  /**
   * Move a branch to the recycle bin. Its messages and job receipts stay intact for restore;
   * the thread is registered as its own root, like a message under a topic.
   */
  removeThread = async (channelId: string, threadId: string): Promise<void> =>
    this.write(
      channelId,
      async (tx, { channel }) => {
        const [row] = await tx
          .select({ root: channelMessages.content, thread: channelThreads })
          .from(channelThreads)
          .innerJoin(
            channelMessages,
            and(
              eq(channelMessages.channelId, channelThreads.channelId),
              eq(channelMessages.id, channelThreads.rootMessageId),
            ),
          )
          .where(and(eq(channelThreads.channelId, channelId), eq(channelThreads.id, threadId)));
        if (!row) throw new ChannelError('NOT_FOUND', 'Thread not found');
        // A retry after a scheduling failure must still be authorized, but must not
        // repeat the stamp or release a writer before the coordinator confirms exit.
        if (row.thread.isDeleted) return;
        await stopScope(tx, channelId, { threadId });
        const deletedAt = new Date();
        await tx
          .update(channelThreads)
          .set(trashStamp(deletedAt))
          .where(eq(channelThreads.id, threadId));
        await new TrashModel(this.db, this.userId, this.workspaceId ?? undefined).register(
          {
            deletedAt,
            root: {
              meta: { parentTitle: channel.title },
              projectId: channel.projectId,
              resourceId: threadId,
              resourceType: 'channelThread',
              title: row.root.trim().slice(0, CHANNEL_THREAD_TITLE_LENGTH) || null,
            },
          },
          tx,
        );
        await audit(tx, channelId, 'thread_trashed', threadId);
      },
      { minRole: 'admin' },
    );

  /** Mutes or unmutes an Agent member; see `setMemberMuted`. Returns writers to stop. */
  setMemberMuted = async (channelId: string, memberId: string, muted: boolean) =>
    this.write(channelId, (tx, { channel }) => setMemberMuted(tx, channel, memberId, muted), {
      minRole: 'admin',
    });
  /** Rewrites the text of the caller's own message; see `editMessage`. */
  editMessage = async (channelId: string, messageId: string, content: string) =>
    this.write(channelId, (tx) => editMessage(tx, channelId, this.userId, messageId, content));

  /** Deletes the caller's own message, or any as an admin; see `deleteMessage`. */
  deleteMessage = async (channelId: string, messageId: string): Promise<ChannelJobItem[]> =>
    this.write(channelId, (tx, { member }) =>
      deleteMessage(
        tx,
        channelId,
        { admin: hasRole(member.role, 'admin'), userId: this.userId },
        messageId,
      ),
    );

  /** Sends an unassigned message back to the decision model. Its author or an admin may retry. */
  retryRouting = async (channelId: string, messageId: string): Promise<ChannelMessageItem> =>
    this.write(channelId, async (tx, { member }) => {
      if (!hasRole(member.role, 'admin')) {
        const [message] = await tx
          .select({ userId: channelMessages.userId })
          .from(channelMessages)
          .where(and(eq(channelMessages.channelId, channelId), eq(channelMessages.id, messageId)));
        if (message && message.userId !== member.userId)
          throw new ChannelError('FORBIDDEN', 'Only the author or an admin can retry routing');
      }
      return retryRouting(tx, channelId, messageId);
    });

  /**
   * Queues a reply that could not reach its device again. Like a stop, only its requester or an
   * admin may retry it.
   */
  retryJob = async (channelId: string, jobId: string): Promise<ChannelJobItem> =>
    this.write(channelId, async (tx, { member }) => {
      if (!hasRole(member.role, 'admin')) {
        const [job] = await tx
          .select({ requesterMemberId: channelJobs.requesterMemberId })
          .from(channelJobs)
          .where(and(eq(channelJobs.channelId, channelId), eq(channelJobs.id, jobId)));
        if (job && job.requesterMemberId !== member.id)
          throw new ChannelError('FORBIDDEN', 'Only the requester or an admin can retry this job');
      }
      return retryJob(tx, channelId, jobId);
    });

  private addOwner = async (tx: Transaction, channelId: string) => {
    const [member] = await tx
      .insert(channelMembers)
      .values({
        actorType: 'user',
        channelId,
        lastReadSequence: 0,
        role: 'owner',
        userId: this.userId,
      })
      .returning();
    return member;
  };

  private findDirect = async (
    tx: LobeChatDatabase | Transaction,
    agentId: string,
  ): Promise<ChannelAccess | undefined> => {
    const [row] = await tx
      .select({ channel: channels, member: channelMembers })
      .from(channels)
      .innerJoin(channelMembers, eq(channelMembers.channelId, channels.id))
      .where(
        and(
          eq(channels.agentId, agentId),
          eq(channels.userId, this.userId),
          this.membershipWhere(),
        ),
      )
      .limit(1);
    return row;
  };

  /**
   * The caller's role as permission checks see it. A workspace owner or admin counts at least as
   * an admin of the group Channels they belong to in that workspace; direct and peer
   * conversations stay with their participants. The stored member row keeps its own role.
   */
  private callerRole() {
    if (!this.workspaceId) return sql<ChannelMemberRole | null>`${channelMembers.role}`;
    return sql<ChannelMemberRole | null>`CASE
      WHEN ${channelMembers.role} = 'owner' THEN ${channelMembers.role}
      WHEN ${channels.agentId} IS NULL AND ${channels.peerUserId} IS NULL AND EXISTS (
        SELECT 1 FROM ${workspaceMembers}
        WHERE ${workspaceMembers.workspaceId} = ${channels.workspaceId}
          AND ${workspaceMembers.userId} = ${this.userId}
          AND ${workspaceMembers.deletedAt} IS NULL
          AND ${inArray(workspaceMembers.role, WORKSPACE_MANAGER_ROLES)}
      ) THEN 'admin'
      ELSE ${channelMembers.role}
    END`;
  }

  private membershipWhere() {
    return and(
      eq(channelMembers.actorType, 'user'),
      eq(channelMembers.userId, this.userId),
      eq(channelMembers.status, 'active'),
      or(isNull(channels.agentId), eq(channels.userId, this.userId)),
      this.workspaceId ? eq(channels.workspaceId, this.workspaceId) : isNull(channels.workspaceId),
    );
  }
}

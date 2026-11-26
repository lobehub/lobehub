import {
  type AgentDeviceOverride,
  type ChannelDeviceGrantCard,
  channelMessageAsk,
  channelMessageConnector,
  channelMessageDeletedAt,
  channelMessageDeviceGrant,
  channelMessageEditedAt,
  channelMessageReceipt,
  channelMessageReplyError,
  channelMessageSurfaces,
  channelMessageVia,
  type ChannelReplyError,
  type ChatMessageError,
  contactCardOf,
  defaultChannelAgentDirectory,
  type LobeAgentAgencyConfig,
  resolveAgentAgencyConfig,
} from '@lobechat/types';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import { sanitizeVisitorError } from '../../models/message/visitor';
import {
  agentOperations,
  agents,
  channelJobs,
  channelMemberGrants,
  channelMembers,
  channelMessages,
  channels,
  channelThreads,
  devices,
  topics,
  users,
  workspaceUserSettings,
} from '../../schemas';
import type { Transaction } from '../../type';
import { agentAvatarSql, agentTitleSql } from '../../utils/inboxAgent';
import { notTrashed } from '../../utils/softDelete';
import { agentAccessCards } from './agentAccess';
import { channelAttachments, fileIdsByMessage } from './attachments';
import { isAgentAuthored } from './author';
import { activeMembers } from './delivery';
import { ChannelError } from './error';
import { channelUserNameSql } from './nickname';
import { isOpeningAck } from './openingAck';
import { reactionsByMessage } from './reactions';
import { replyWorksByMessage } from './works';

export const publicMessageColumns = {
  ...getTableColumns(channelMessages),
  senderAgentAvatar: agentAvatarSql(),
  senderAgentName: agents.name,
  senderAgentTitle: agentTitleSql(),
  senderUserAvatar: users.avatar,
  senderUserName: channelUserNameSql(channelMessages.channelId, channelMessages.userId),
  senderUsername: users.username,
};

type MessageRow = typeof channelMessages.$inferSelect & {
  senderAgentAvatar: string | null;
  senderAgentName: string | null;
  senderAgentTitle: string | null;
  senderUserAvatar: string | null;
  senderUserName: string | null;
  senderUsername: string | null;
};

/**
 * Messages on this page whose card belongs to a shared Agent's run. Their failure text is the
 * owner's diagnostics, so `publicMessage` returns the share page's projection on every read.
 */
const sharedCardMessageIds = async (tx: Transaction, rows: MessageRow[]) => {
  const jobIds = rows
    .map((row) => channelMessageReplyError(row.metadata)?.jobId)
    .filter((jobId): jobId is string => !!jobId);
  if (!jobIds.length) return new Set<string>();
  const shared = await tx
    .select({ id: channelJobs.id })
    .from(channelJobs)
    .where(
      and(
        inArray(channelJobs.id, jobIds),
        sql`jsonb_exists(${channelJobs.executionConfig}, 'share')`,
      ),
    );
  const sharedJobIds = new Set(shared.map((row) => row.id));
  return new Set(
    rows
      .filter((row) => sharedJobIds.has(channelMessageReplyError(row.metadata)?.jobId ?? ''))
      .map((row) => row.id),
  );
};

/**
 * The card's own failure text, as a visitor sees it. A card written while its share showed
 * details keeps that text; a read after the owner turned details off must not hand it back, so
 * every read applies the share page's projection, as `readJobs` does on the job.
 */
const redactCardError = (card: ChannelReplyError): ChannelReplyError => ({
  ...card,
  errorMessage: null,
  errorType: null,
});

export const publicMessage = (
  row: MessageRow,
  fileIds: string[],
  options: { redactCardError?: boolean } = {},
) => {
  const {
    senderAgentAvatar,
    senderAgentName,
    senderAgentTitle,
    senderUserAvatar,
    senderUserName,
    senderUsername,
    ...message
  } = row;
  const isAgent = isAgentAuthored(message);
  const card = (isAgent && channelMessageReplyError(message.metadata)) || null;
  const replyError = card && options.redactCardError ? redactCardError(card) : card;
  const visible =
    replyError === card ? message : { ...message, metadata: { ...message.metadata, replyError } };
  return {
    ...visible,
    fileIds,
    author: {
      avatar: isAgent ? senderAgentAvatar : senderUserAvatar,
      id: isAgent ? message.agentId : message.userId,
      name: isAgent ? senderAgentName || senderAgentTitle : senderUserName || senderUsername,
      type: isAgent ? ('agent' as const) : ('user' as const),
    },
    // A deleted question keeps its row as a tombstone, but nothing is left to answer.
    ask:
      message.kind === 'ask' && !channelMessageDeletedAt(message.metadata)
        ? (channelMessageAsk(message.metadata) ?? null)
        : null,
    card: contactCardOf(message.metadata) ?? null,
    // An Agent asking the reader to connect a connector it needs.
    connector: (isAgent && channelMessageConnector(message.metadata)) || null,
    deletedAt: channelMessageDeletedAt(message.metadata),
    editedAt: channelMessageEditedAt(message.metadata),
    // On an Agent's message, the exchange between Agents it reports from.
    receipt: (() => {
      const receipt = channelMessageReceipt(message.metadata);
      if (!receipt) return null;
      const { agent, ...rest } = receipt;
      return { ...rest, agent: agent && { ...agent, avatar: null as string | null } };
    })(),
    // An Agent's failed reply, shown as a card in its reply slot.
    replyError,
    // Cards the Agent drew in this reply.
    // A deleted reply is a tombstone: its cards are gone with its text.
    surfaces:
      isAgent && !channelMessageDeletedAt(message.metadata)
        ? channelMessageSurfaces(message.metadata)
        : [],
    surfacesBodyLength:
      typeof message.metadata?.surfacesBodyLength === 'number'
        ? message.metadata.surfacesBodyLength
        : undefined,
    via: isAgent
      ? null
      : (() => {
          const via = channelMessageVia(message.metadata);
          return via ? { ...via, avatar: null as string | null } : null;
        })(),
  };
};

/**
 * Avatars of the Agents named in `via` or in a report's `receipt.agent`, which usually are not
 * members of this Channel. An Agent deleted since keeps the name the message recorded, without
 * an avatar.
 */
const relayAgentAvatars = async (tx: Transaction, rows: MessageRow[]) => {
  const ids = [
    ...new Set(
      rows.flatMap((row) => {
        const via = row.routingStatus === 'reply' ? undefined : channelMessageVia(row.metadata);
        const reported = channelMessageReceipt(row.metadata)?.agent;
        return [...(via ? [via.agentId] : []), ...(reported ? [reported.agentId] : [])];
      }),
    ),
  ];
  if (!ids.length) return new Map<string, string | null>();
  const found = await tx
    .select({ avatar: agentAvatarSql(), id: agents.id })
    .from(agents)
    .where(inArray(agents.id, ids));
  return new Map(found.map(({ avatar, id }) => [id, avatar] as const));
};

type AvatarAgent = { agentId: string; avatar: string | null };
const withRelayAvatar = <
  T extends {
    receipt?: { agent?: AvatarAgent } | null;
    via?: AvatarAgent | null;
  },
>(
  message: T,
  avatars: Map<string, string | null>,
): T => {
  const avatarOf = <A extends AvatarAgent>(agent: A): A => ({
    ...agent,
    avatar: avatars.get(agent.agentId) ?? null,
  });
  return {
    ...message,
    ...(message.via && { via: avatarOf(message.via) }),
    ...(message.receipt?.agent && {
      receipt: { ...message.receipt, agent: avatarOf(message.receipt.agent) },
    }),
  };
};

/**
 * The current status of the device requests an Agent's cards on this page carry, for the device
 * owner reading them. A grant that is gone (its environment moved, or the member left) reads as
 * `expired`; a card the viewer does not own reads as nothing.
 */
const deviceGrantCards = async (
  tx: Transaction,
  rows: MessageRow[],
  viewerUserId: string | undefined,
) => {
  const requests = rows.flatMap((row) => {
    const request = isAgentAuthored(row) && channelMessageDeviceGrant(row.metadata);
    return request ? [[row.id, request] as const] : [];
  });
  const cards = new Map<string, ChannelDeviceGrantCard>();
  if (!viewerUserId || !requests.length) return cards;
  const found = await tx
    .select({
      deviceOwnerId: channelMemberGrants.deviceOwnerId,
      id: channelMemberGrants.id,
      status: channelMemberGrants.status,
    })
    .from(channelMemberGrants)
    .where(
      inArray(
        channelMemberGrants.id,
        requests.map(([, request]) => request.grantId),
      ),
    );
  const grants = new Map(found.map((grant) => [grant.id, grant]));
  for (const [messageId, request] of requests) {
    const grant = grants.get(request.grantId);
    if (grant && grant.deviceOwnerId !== viewerUserId) continue;
    cards.set(messageId, { ...request, status: grant?.status ?? 'expired' });
  }
  return cards;
};

/** Public projection only. Execution settings, drafts and internal messages never leave this boundary. */
/**
 * The Agent topic behind each published reply, for replies the viewer ran: the topic belongs to
 * the requester, so other members never learn its id.
 */
const sourceTopicsByMessage = async (
  tx: Transaction,
  channelId: string,
  messageIds: string[],
  viewerUserId: string | undefined,
) => {
  if (!viewerUserId || !messageIds.length)
    return new Map<string, { id: string; title: string | null }>();
  const rows = await tx
    .select({
      messageId: channelJobs.publishedMessageId,
      title: topics.title,
      topicId: topics.id,
    })
    .from(channelJobs)
    .innerJoin(topics, eq(topics.id, channelJobs.topicId))
    .where(
      and(
        eq(channelJobs.channelId, channelId),
        inArray(channelJobs.publishedMessageId, messageIds),
        eq(topics.userId, viewerUserId),
        notTrashed(topics.isDeleted),
      ),
    );
  return new Map(rows.map((row) => [row.messageId!, { id: row.topicId, title: row.title }]));
};

const THREAD_PREVIEW_LENGTH = 240;

type ThreadSummary = {
  lastNewsAt: Date | null;
  lastReply: Pick<ReturnType<typeof publicMessage>, 'author' | 'content' | 'createdAt' | 'id'>;
  replyCount: number;
};

/** Reply count and newest reply per thread, so a root can show what it branched into. */
const threadSummaries = async (tx: Transaction, channelId: string, threadIds: string[]) => {
  if (!threadIds.length) return new Map<string, ThreadSummary>();
  const scope = and(
    eq(channelMessages.channelId, channelId),
    inArray(channelMessages.threadId, threadIds),
  );
  const [counts, latest] = await Promise.all([
    tx
      .select({
        lastNewsAt:
          sql<Date | null>`max(${channelMessages.createdAt}) filter (where not (${isOpeningAck}))`.mapWith(
            channelMessages.createdAt,
          ),
        replyCount: count(),
        threadId: channelMessages.threadId,
      })
      .from(channelMessages)
      .where(scope)
      .groupBy(channelMessages.threadId),
    tx
      .selectDistinctOn([channelMessages.threadId], publicMessageColumns)
      .from(channelMessages)
      .leftJoin(users, eq(users.id, channelMessages.userId))
      .leftJoin(agents, eq(agents.id, channelMessages.agentId))
      .where(scope)
      .orderBy(asc(channelMessages.threadId), desc(channelMessages.sequence)),
  ]);
  const countsByThread = new Map(counts.map((row) => [row.threadId, row]));
  return new Map<string, ThreadSummary>(
    latest.map((row) => {
      const { author, content, createdAt, id } = publicMessage(row, []);
      return [
        row.threadId!,
        {
          lastNewsAt: countsByThread.get(row.threadId)?.lastNewsAt ?? null,
          lastReply: { author, content: content.slice(0, THREAD_PREVIEW_LENGTH), createdAt, id },
          replyCount: countsByThread.get(row.threadId)?.replyCount ?? 0,
        },
      ];
    }),
  );
};

/**
 * A job as the public view shows it. The repository drops `requesterMemberId`, and keeps
 * `topicId` only for the viewer who owns that topic (`topicOwnerId`), as replies keep
 * `sourceTopicId`: the topic belongs to the requester, so other members never learn its id.
 */
const publicJobColumns = {
  id: channelJobs.id,
  memberId: channelJobs.memberId,
  messageId: channelJobs.messageId,
  requesterMemberId: channelJobs.requesterMemberId,
  threadId: channelJobs.threadId,
  status: channelJobs.status,
  blockedCode: channelJobs.blockedCode,
  // Only a bounded diagnostic message crosses the public boundary, never the raw error.
  errorMessage: sql<string | null>`CASE WHEN ${channelJobs.status} = 'failed'
      THEN left(${agentOperations.error}->>'message', 2000) ELSE NULL END`,
  // The error's category, so a client can explain a known failure in the viewer's language.
  errorType: sql<string | null>`CASE WHEN ${channelJobs.status} = 'failed'
      THEN ${agentOperations.error}->>'type' ELSE NULL END`,
  // The device the reply runs on, waits for, or failed to reach: the claimed device, the
  // one a failed dispatch was routed to, or the Agent's own bound device.
  deviceId: sql<string | null>`COALESCE(
      ${channelJobs.deviceId},
      ${agentOperations.error}->'deviceRoute'->>'deviceId',
      ${channelJobs.executionConfig}->'agencyConfig'->>'boundDeviceId'
    )`,
  writerHeld: channelJobs.writerHeld,
  // The acknowledgement posted before the run (`openingRequestKey`), so a failure shows under it.
  openingMessageId: sql<string | null>`(SELECT ${channelMessages.id} FROM ${channelMessages}
      WHERE ${channelMessages.channelId} = ${channelJobs.channelId}
        AND ${channelMessages.requestKey} = 'opening:' || ${channelJobs.id}::text)`,
  topicId: channelJobs.topicId,
  // Its name, under the same owner-only rule as the id, so a reply at work says which topic it is.
  topicTitle: topics.title,
  // A trashed topic has no owner here, so its link goes with it.
  topicOwnerId: sql<string | null>`CASE WHEN ${notTrashed(topics.isDeleted)}
      THEN ${topics.userId} ELSE NULL END`,
  worktreeBranch: sql<string | null>`${channelJobs.executionConfig}->>'worktreeBranch'`,
  operationStatus: agentOperations.status,
  createdAt: channelJobs.createdAt,
  publicationRevoked: channelJobs.publicationRevoked,
  // Read only to redact the error of a shared Agent's run, then dropped by `readJobs`.
  sharedRun: sql<boolean>`COALESCE(jsonb_exists(${channelJobs.executionConfig}, 'share'), false)`,
};

/** At most this many of a main view's threads' jobs still at work ride along with its own. */
const THREAD_ACTIVE_JOB_LIMIT = 50;

/**
 * A shared Agent runs under its owner's credentials, so its failure text can carry the owner's
 * provider or infrastructure diagnostics. The viewer of such a run is the visitor, who gets the
 * share page's projection (`sanitizeVisitorError`): a classified type, and the message only for
 * the few visitor-safe codes.
 */
const redactSharedRunError = <
  Job extends {
    errorMessage: string | null;
    errorType: string | null;
    sharedRun: boolean;
  },
>({
  sharedRun,
  ...job
}: Job) => {
  // A failure that records only its type is redacted too: the type alone can name the owner's
  // provider or budget (`InsufficientBudgetForModel`), which a visitor must not learn.
  if (!sharedRun || (job.errorMessage === null && job.errorType === null)) return job;
  const safe = sanitizeVisitorError({
    message: job.errorMessage,
    type: job.errorType ?? undefined,
  } as ChatMessageError);
  return { ...job, errorMessage: safe?.message ?? null, errorType: safe?.type?.toString() ?? null };
};

const readJobs = async (tx: Transaction, where: SQL | undefined, limit: number) => {
  const rows = await tx
    .select(publicJobColumns)
    .from(channelJobs)
    .leftJoin(agentOperations, eq(agentOperations.id, channelJobs.operationId))
    .leftJoin(topics, eq(topics.id, channelJobs.topicId))
    .where(where)
    .orderBy(desc(channelJobs.createdAt))
    .limit(limit);
  return rows.map(redactSharedRunError);
};

interface MemberDevice {
  agentId: string | null;
  deviceId: string | null;
  deviceOwnerId: string | null;
}

interface MemberDeviceInfo {
  defaultCwd: string | null;
  name: string | null;
}

/**
 * The devices Agent members run on, keyed by member: display name and default directory. A device
 * id is unique only within its principal, so each one resolves the way execution does: the
 * Channel's workspace device first, else the personal device of the member who owns it.
 */
const memberDevices = async (
  tx: Transaction,
  workspaceId: string | null,
  members: MemberDevice[],
) => {
  const configured = members.filter(
    (member): member is MemberDevice & { deviceId: string } =>
      !!member.agentId && !!member.deviceId,
  );
  const infos = new Map<MemberDevice, MemberDeviceInfo>();
  if (!configured.length) return infos;

  const owners = [
    ...new Set(
      configured.flatMap((member) => (member.deviceOwnerId ? [member.deviceOwnerId] : [])),
    ),
  ];
  const scopes = [
    workspaceId ? eq(devices.workspaceId, workspaceId) : undefined,
    owners.length ? and(isNull(devices.workspaceId), inArray(devices.userId, owners)) : undefined,
  ].filter((scope): scope is SQL => !!scope);
  if (!scopes.length) return infos;

  const rows = await tx
    .select({
      defaultCwd: devices.defaultCwd,
      deviceId: devices.deviceId,
      friendlyName: devices.friendlyName,
      hostname: devices.hostname,
      userId: devices.userId,
      workspaceId: devices.workspaceId,
    })
    .from(devices)
    .where(
      and(
        inArray(
          devices.deviceId,
          configured.map((member) => member.deviceId),
        ),
        or(...scopes),
      ),
    );
  for (const member of configured) {
    const row =
      rows.find((entry) => entry.deviceId === member.deviceId && entry.workspaceId) ??
      rows.find(
        (entry) =>
          entry.deviceId === member.deviceId &&
          !entry.workspaceId &&
          entry.userId === member.deviceOwnerId,
      );
    if (row)
      infos.set(member, {
        defaultCwd: row.defaultCwd,
        name: row.friendlyName || row.hostname || null,
      });
  }
  return infos;
};

interface EnvironmentViewer {
  /** The viewer's own device picks per Agent in the Channel's workspace. */
  deviceOverrides: Record<string, AgentDeviceOverride>;
  userId: string | undefined;
  workspaceId: string | null;
}

/**
 * Where an Agent member runs: the device and directory the Channel picked for it, else the device
 * a request from the viewer routes to, the Agent's own binding with the viewer's device override
 * on top, as the run resolves it. Shown only when that is one fixed device the viewer may see: a
 * workspace Agent in its own workspace's Channel, or a personal Agent to its owner, so a share
 * link visitor never learns the owner's device. Any other target (auto, local, sandbox) picks its
 * device per run, so there is none to show ahead of it.
 */
const memberEnvironmentSource = <
  T extends {
    agencyConfig: LobeAgentAgencyConfig | null;
    agentId: string | null;
    agentUserId: string | null;
    agentVisibility: 'private' | 'public' | null;
    agentWorkspaceId: string | null;
    deviceId: string | null;
    deviceOwnerId: string | null;
    workingDirectory: string | null;
  },
>(
  row: T,
  viewer: EnvironmentViewer,
): T & { inheritedConfig: LobeAgentAgencyConfig | null } => {
  const none = { ...row, inheritedConfig: null };
  if (!row.agentId || row.deviceId || row.workingDirectory) return none;
  const visible = row.agentWorkspaceId
    ? row.agentWorkspaceId === viewer.workspaceId
    : !!viewer.userId && row.agentUserId === viewer.userId;
  if (!visible) return none;
  const override = row.agentWorkspaceId ? viewer.deviceOverrides[row.agentId] : undefined;
  const config = resolveAgentAgencyConfig(row.agencyConfig, override, {
    canManage: !!viewer.userId && row.agentUserId === viewer.userId,
    visibility: row.agentVisibility ?? undefined,
    workspaceId: row.agentWorkspaceId,
  });
  if (config?.executionTarget !== 'device' || !config.boundDeviceId) return none;
  return {
    ...row,
    deviceId: config.boundDeviceId,
    // A device the viewer picked may be their own personal one.
    deviceOwnerId:
      override?.boundDeviceId === config.boundDeviceId ? viewer.userId! : row.agentUserId,
    inheritedConfig: config,
  };
};

/**
 * Whether the viewer may open an Agent member's own page: the agent ownership predicate
 * (`buildWorkspaceWhere`) read off the joined row. In a workspace Channel that is a live Agent of
 * the same workspace, public or created by the viewer; in a personal one, the viewer's own.
 */
export const canViewerOpenAgent = (
  row: {
    agentDeleted: boolean | null;
    agentUserId: string | null;
    agentVisibility: 'private' | 'public' | null;
    agentWorkspaceId: string | null;
  },
  viewer: Pick<EnvironmentViewer, 'userId' | 'workspaceId'>,
): boolean => {
  if (!viewer.userId || !row.agentUserId || row.agentDeleted === true) return false;
  const own = row.agentUserId === viewer.userId;
  if (!viewer.workspaceId) return !row.agentWorkspaceId && own;
  return row.agentWorkspaceId === viewer.workspaceId && (row.agentVisibility !== 'private' || own);
};

const environmentViewer = async (
  tx: Transaction,
  channelId: string,
  userId: string | undefined,
): Promise<EnvironmentViewer> => {
  const [channel] = await tx
    .select({ workspaceId: channels.workspaceId })
    .from(channels)
    .where(eq(channels.id, channelId));
  const workspaceId = channel?.workspaceId ?? null;
  const [settings] =
    workspaceId && userId
      ? await tx
          .select({ preference: workspaceUserSettings.preference })
          .from(workspaceUserSettings)
          .where(
            and(
              eq(workspaceUserSettings.workspaceId, workspaceId),
              eq(workspaceUserSettings.userId, userId),
            ),
          )
      : [];
  return {
    deviceOverrides: settings?.preference.agentDeviceOverrides ?? {},
    userId,
    workspaceId,
  };
};

/**
 * A view's jobs as one viewer sees them: who may stop each, and the run's topic (id and title)
 * only for the viewer who runs the reply; for anyone else the job carries no topic at all.
 */
export const viewerJobs = (
  jobs: Awaited<ReturnType<typeof readChannelView>>['jobs'],
  viewerUserId: string,
  canStop: (requesterMemberId: string | null) => boolean,
) =>
  jobs.map(({ requesterMemberId, topicId, topicOwnerId, topicTitle, ...job }) => ({
    ...job,
    canStop: canStop(requesterMemberId),
    ...(topicId && topicOwnerId === viewerUserId ? { topicId, topicTitle } : {}),
  }));

export const readChannelView = async (
  tx: Transaction,
  channelId: string,
  options: {
    before?: number;
    /** The client opens canvases from reply cards; see `replyWorksByMessage`. */
    includeCanvasWorks?: boolean;
    /** The client renders the opt-in Work types on reply cards; see `replyWorksByMessage`. */
    includeFileWorks?: boolean;
    limit?: number;
    threadId?: string | null;
  } = {},
  viewerUserId?: string,
) => {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 100));
  const [members, reversed, threads, ownJobs, threadJobs] = await Promise.all([
    tx
      .select({
        actorType: channelMembers.actorType,
        agentId: channelMembers.agentId,
        avatar: agentAvatarSql(),
        // The same fallback routing uses: a Channel-specific description, else the Agent's own.
        description: sql<
          string | null
        >`coalesce(nullif(${channelMembers.description}, ''), ${agents.description})`,
        id: channelMembers.id,
        invitedBy: sql<string | null>`${channelMembers.metadata}->>'invitedBy'`,
        muted: sql<boolean>`coalesce((${channelMembers.config}->>'muted')::boolean, false)`,
        name: channelMembers.name,
        role: channelMembers.role,
        status: channelMembers.status,
        userId: channelMembers.userId,
        userName: channelUserNameSql(channelMembers.channelId, channelMembers.userId),
        username: users.username,
        userAvatar: users.avatar,
        lastReadSequence: channelMembers.lastReadSequence,
        joinedAt: channelMembers.createdAt,
        deviceId: sql<string | null>`${channelMembers.config}->>'deviceId'`,
        deviceOwnerId: sql<string | null>`${channelMembers.config}->>'deviceOwnerId'`,
        workingDirectory: sql<string | null>`${channelMembers.config}->>'workingDirectory'`,
        grantDeviceId: channelMemberGrants.deviceId,
        grantDeviceOwnerId: channelMemberGrants.deviceOwnerId,
        grantId: channelMemberGrants.id,
        grantStatus: channelMemberGrants.status,
        grantWorkingDirectory: channelMemberGrants.workingDirectory,
        agencyConfig: agents.agencyConfig,
        agentDeleted: agents.isDeleted,
        agentUserId: agents.userId,
        agentVisibility: agents.visibility,
        agentWorkspaceId: agents.workspaceId,
      })
      .from(channelMembers)
      .leftJoin(users, eq(users.id, channelMembers.userId))
      .leftJoin(agents, eq(agents.id, channelMembers.agentId))
      .leftJoin(channelMemberGrants, eq(channelMemberGrants.memberId, channelMembers.id))
      .where(eq(channelMembers.channelId, channelId))
      .orderBy(asc(channelMembers.createdAt)),
    tx
      .select(publicMessageColumns)
      .from(channelMessages)
      .leftJoin(users, eq(users.id, channelMessages.userId))
      .leftJoin(agents, eq(agents.id, channelMessages.agentId))
      .where(
        and(
          eq(channelMessages.channelId, channelId),
          options.threadId
            ? eq(channelMessages.threadId, options.threadId)
            : isNull(channelMessages.threadId),
          options.before === undefined ? undefined : lt(channelMessages.sequence, options.before),
        ),
      )
      .orderBy(desc(channelMessages.sequence))
      .limit(limit + 1),
    tx
      .select()
      .from(channelThreads)
      .where(
        and(
          eq(channelThreads.channelId, channelId),
          notTrashed(channelThreads.isDeleted),
          // A Thread's view needs only its own entry, not every Thread in the Channel.
          options.threadId ? eq(channelThreads.id, options.threadId) : undefined,
        ),
      )
      .orderBy(asc(channelThreads.createdAt)),
    readJobs(
      tx,
      and(
        eq(channelJobs.channelId, channelId),
        options.threadId
          ? eq(channelJobs.threadId, options.threadId)
          : isNull(channelJobs.threadId),
      ),
      200,
    ),
    // The main timeline also carries its threads' replies still at work, so a thread card and
    // the header can show an Agent working without loading every thread. Bounded on its own,
    // so busy threads never push the main conversation's own jobs out of its limit.
    options.threadId
      ? []
      : readJobs(
          tx,
          and(
            eq(channelJobs.channelId, channelId),
            isNotNull(channelJobs.threadId),
            or(
              inArray(channelJobs.status, ['queued', 'running']),
              eq(channelJobs.writerHeld, true),
            ),
          ),
          THREAD_ACTIVE_JOB_LIMIT,
        ),
  ]);
  const viewer = await environmentViewer(tx, channelId, viewerUserId);
  const environments = members.map((row) => memberEnvironmentSource(row, viewer));
  const deviceInfos = await memberDevices(tx, viewer.workspaceId, environments);
  const jobs = [...ownJobs, ...threadJobs].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  if (options.threadId && !threads.some((thread) => thread.id === options.threadId))
    throw new ChannelError('NOT_FOUND', 'Thread not found');
  const thread = threads.find((entry) => entry.id === options.threadId);
  const [rootMessage] = thread
    ? await tx
        .select(publicMessageColumns)
        .from(channelMessages)
        .leftJoin(users, eq(users.id, channelMessages.userId))
        .leftJoin(agents, eq(agents.id, channelMessages.agentId))
        .where(
          and(
            eq(channelMessages.channelId, channelId),
            eq(channelMessages.id, thread.rootMessageId),
          ),
        )
    : [];
  const page = reversed.slice(0, limit).reverse();
  // Only main-timeline roots on this page show a thread card; other views skip the scan.
  const pageIds = new Set(page.map((message) => message.id));
  const summarized = options.threadId
    ? []
    : threads.filter((entry) => pageIds.has(entry.rootMessageId)).map((entry) => entry.id);
  const summaries = await threadSummaries(tx, channelId, summarized);
  const sharedCards = await sharedCardMessageIds(tx, [
    ...page,
    ...(rootMessage ? [rootMessage] : []),
  ]);
  const quoteIds = [
    ...new Set(
      [...page, ...(rootMessage ? [rootMessage] : [])].flatMap((message) =>
        message.replyToId ? [message.replyToId] : [],
      ),
    ),
  ];
  const quoted = quoteIds.length
    ? await tx
        .select(publicMessageColumns)
        .from(channelMessages)
        .leftJoin(users, eq(users.id, channelMessages.userId))
        .leftJoin(agents, eq(agents.id, channelMessages.agentId))
        .where(and(eq(channelMessages.channelId, channelId), inArray(channelMessages.id, quoteIds)))
    : [];
  const quotes = new Map(
    quoted.map((row) => {
      const { author, content, deletedAt, id, sequence, threadId } = publicMessage(row, []);
      return [
        id,
        { author, content: content.slice(0, 240), deletedAt, id, sequence, threadId },
      ] as const;
    }),
  );
  const files = await fileIdsByMessage(tx, [
    ...page.map((message) => message.id),
    ...(rootMessage ? [rootMessage.id] : []),
  ]);
  const replyIds = [...page, ...(rootMessage ? [rootMessage] : [])].flatMap((message) =>
    message.routingStatus === 'reply' ? [message.id] : [],
  );
  const [sourceTopics, works, relayAvatars, grantCards, accessCards, reactions] = await Promise.all(
    [
      sourceTopicsByMessage(tx, channelId, replyIds, viewerUserId),
      replyWorksByMessage(tx, channelId, replyIds, {
        includeCanvasWorks: options.includeCanvasWorks,
        includeFileWorks: options.includeFileWorks,
        userId: viewerUserId,
      }),
      relayAgentAvatars(tx, [...page, ...(rootMessage ? [rootMessage] : [])]),
      deviceGrantCards(tx, [...page, ...(rootMessage ? [rootMessage] : [])], viewerUserId),
      agentAccessCards(tx, [...page, ...(rootMessage ? [rootMessage] : [])], viewerUserId),
      reactionsByMessage(
        tx,
        channelId,
        [...page, ...(rootMessage ? [rootMessage] : [])].map((message) => message.id),
        // The viewer's own reaction is always named, so its chip shows as theirs.
        members.find((member) => member.actorType === 'user' && member.userId === viewerUserId)?.id,
      ),
    ],
  );
  // A tombstone keeps its row for the Threads and replies that point at it, not its reactions.
  const reactionsOf = (message: MessageRow) =>
    channelMessageDeletedAt(message.metadata) ? [] : (reactions.get(message.id) ?? []);
  const ids = [...new Set([...files.values()].flat())];
  const attachments = await channelAttachments(tx, ids);
  return {
    attachments,
    hasMore: reversed.length > limit,
    jobs,
    members: environments.map((row) => {
      const {
        agencyConfig: _agencyConfig,
        agentDeleted,
        agentUserId,
        agentVisibility,
        agentWorkspaceId,
        deviceId,
        deviceOwnerId,
        grantDeviceId,
        grantDeviceOwnerId,
        grantId,
        grantStatus,
        grantWorkingDirectory,
        inheritedConfig,
        workingDirectory: channelDirectory,
        ...member
      } = row;
      // Only a grant for exactly the Channel's current pick speaks for it; a stale one is moot.
      const grant =
        grantId &&
        grantStatus &&
        grantDeviceOwnerId &&
        !inheritedConfig &&
        grantDeviceId === deviceId &&
        grantDeviceOwnerId === deviceOwnerId &&
        grantWorkingDirectory === channelDirectory
          ? { deviceOwnerId: grantDeviceOwnerId, id: grantId, status: grantStatus }
          : null;
      const device = deviceInfos.get(row);
      // An inherited device works in the Agent's own folder there, else the device's default.
      const workingDirectory =
        inheritedConfig && deviceId
          ? (defaultChannelAgentDirectory(inheritedConfig, deviceId, device?.defaultCwd) ?? null)
          : channelDirectory;
      return {
        ...member,
        ...(member.agentId
          ? {
              canOpenAgent: canViewerOpenAgent(
                { agentDeleted, agentUserId, agentVisibility, agentWorkspaceId },
                viewer,
              ),
            }
          : {}),
        environment:
          member.agentId && (deviceId || workingDirectory)
            ? {
                deviceId,
                deviceName: device?.name ?? null,
                ...(grant ? { grant } : {}),
                workingDirectory,
              }
            : null,
      };
    }),
    threads: threads.map((entry) => {
      const title = entry.metadata?.title;
      const named = typeof title === 'string' && title ? { ...entry, title } : entry;
      return summarized.includes(entry.id)
        ? {
            ...named,
            lastNewsAt: summaries.get(entry.id)?.lastNewsAt ?? null,
            lastReply: summaries.get(entry.id)?.lastReply ?? null,
            replyCount: summaries.get(entry.id)?.replyCount ?? 0,
          }
        : named;
    }),
    rootMessage: rootMessage
      ? {
          ...withRelayAvatar(
            publicMessage(rootMessage, files.get(rootMessage.id) ?? [], {
              redactCardError: sharedCards.has(rootMessage.id),
            }),
            relayAvatars,
          ),
          agentAccess: accessCards.get(rootMessage.id) ?? null,
          deviceGrant: grantCards.get(rootMessage.id) ?? null,
          sourceTopicId: sourceTopics.get(rootMessage.id)?.id ?? null,
          sourceTopicTitle: sourceTopics.get(rootMessage.id)?.title ?? null,
          works: works.get(rootMessage.id) ?? [],
          reactions: reactionsOf(rootMessage),
          replyTo: rootMessage.replyToId ? (quotes.get(rootMessage.replyToId) ?? null) : null,
        }
      : null,
    messages: page.map((message) => ({
      ...withRelayAvatar(
        publicMessage(message, files.get(message.id) ?? [], {
          redactCardError: sharedCards.has(message.id),
        }),
        relayAvatars,
      ),
      agentAccess: accessCards.get(message.id) ?? null,
      deviceGrant: grantCards.get(message.id) ?? null,
      sourceTopicId: sourceTopics.get(message.id)?.id ?? null,
      sourceTopicTitle: sourceTopics.get(message.id)?.title ?? null,
      works: works.get(message.id) ?? [],
      reactions: reactionsOf(message),
      replyTo: message.replyToId ? (quotes.get(message.replyToId) ?? null) : null,
    })),
  };
};

/** A branch freezes its main-line boundary; opening it never creates or replays a job. */
export const createChannelThread = async (
  tx: Transaction,
  channelId: string,
  input: { followerMemberIds?: string[]; rootMessageId: string },
) => {
  const [root] = await tx
    .select()
    .from(channelMessages)
    .where(
      and(eq(channelMessages.channelId, channelId), eq(channelMessages.id, input.rootMessageId)),
    );
  if (!root || root.threadId)
    throw new ChannelError('BAD_REQUEST', 'Choose a message on the main timeline');
  const [existing] = await tx
    .select()
    .from(channelThreads)
    .where(
      and(
        eq(channelThreads.channelId, channelId),
        eq(channelThreads.rootMessageId, root.id),
        notTrashed(channelThreads.isDeleted),
      ),
    );
  if (existing) return existing;
  // Explicit selections are validated; inferred recipients may have left since the root.
  const followers = input.followerMemberIds
    ? await activeMembers(tx, channelId, input.followerMemberIds)
    : root.recipientMemberIds.length
      ? await tx
          .select({ id: channelMembers.id })
          .from(channelMembers)
          .where(
            and(
              eq(channelMembers.channelId, channelId),
              eq(channelMembers.status, 'active'),
              inArray(channelMembers.id, root.recipientMemberIds),
            ),
          )
      : [];
  // An Agent reply has no recipients. Branching from it must still carry its author
  // into the thread, without substituting a removed or rebound member's new Agent.
  const authors = root.agentId
    ? await tx
        .select({ id: channelMembers.id })
        .from(channelMembers)
        .where(
          and(
            eq(channelMembers.channelId, channelId),
            eq(channelMembers.agentId, root.agentId),
            eq(channelMembers.actorType, 'agent'),
            eq(channelMembers.status, 'active'),
          ),
        )
    : [];
  const [thread] = await tx
    .insert(channelThreads)
    .values({
      channelId,
      followerMemberIds: [...new Set([...followers, ...authors].map((member) => member.id))],
      rootMessageId: root.id,
      rootSequence: root.sequence,
    })
    .returning();
  return thread;
};

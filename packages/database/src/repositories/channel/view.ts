import {
  type AgentDeviceOverride,
  channelMessageDeletedAt,
  channelMessageEditedAt,
  channelMessageReceipt,
  channelMessageVia,
  contactCardOf,
  type ChatMessageError,
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
  like,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';

import { sanitizeVisitorError } from '../../models/message/visitor';
import {
  agentOperations,
  agents,
  agentShares,
  channelJobs,
  channelMembers,
  channelMessages,
  channels,
  channelThreads,
  devices,
  files as fileTable,
  topics,
  users,
  workspaceUserSettings,
} from '../../schemas';
import type { Transaction } from '../../type';
import { agentAvatarSql, agentTitleSql } from '../../utils/inboxAgent';
import { notTrashed } from '../../utils/softDelete';
import { fileIdsByMessage } from './attachments';
import { isAgentAuthored } from './author';
import { activeMembers } from './delivery';
import { ChannelError } from './error';
import { externalWorksByMessage } from './works';

export const publicMessageColumns = {
  ...getTableColumns(channelMessages),
  senderAgentAvatar: agentAvatarSql(),
  senderAgentName: agents.name,
  senderAgentTitle: agentTitleSql(),
  senderUserAvatar: users.avatar,
  senderUserName: users.fullName,
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

export const publicMessage = (row: MessageRow, fileIds: string[]) => {
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
  return {
    ...message,
    fileIds,
    author: {
      avatar: isAgent ? senderAgentAvatar : senderUserAvatar,
      id: isAgent ? message.agentId : message.userId,
      name: isAgent ? senderAgentName || senderAgentTitle : senderUserName || senderUsername,
      type: isAgent ? ('agent' as const) : ('user' as const),
    },
    card: contactCardOf(message.metadata) ?? null,
    deletedAt: channelMessageDeletedAt(message.metadata),
    editedAt: channelMessageEditedAt(message.metadata),
    // On an Agent's message, the exchange between Agents it reports from.
    receipt: (() => {
      const receipt = channelMessageReceipt(message.metadata);
      if (!receipt) return null;
      const { agent, ...rest } = receipt;
      return { ...rest, agent: agent && { ...agent, avatar: null as string | null } };
    })(),
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

/**
 * Request keys of the acknowledgements an Agent posts before its run (`openingRequestKey` in
 * `./opening`, which imports this module, so the prefix is repeated here).
 */
const OPENING_REQUEST_KEY_PATTERN = 'opening:%';

/** An Agent's acknowledgement before its run: it says the work started, not what came of it. */
const isOpeningAck = and(
  eq(channelMessages.routingStatus, 'reply'),
  like(channelMessages.requestKey, OPENING_REQUEST_KEY_PATTERN),
);

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
  // A trashed topic has no owner here, so its link goes with it.
  topicOwnerId: sql<string | null>`CASE WHEN ${notTrashed(topics.isDeleted)}
      THEN ${topics.userId} ELSE NULL END`,
  worktreeBranch: sql<string | null>`${channelJobs.executionConfig}->>'worktreeBranch'`,
  operationStatus: agentOperations.status,
  createdAt: channelJobs.createdAt,
  publicationRevoked: channelJobs.publicationRevoked,
  // Read only to redact the error of a shared Agent's run, then dropped by `readJobs`.
  sharedRun: sql<boolean>`COALESCE(jsonb_exists(${channelJobs.executionConfig}, 'share'), false)`,
  shareShowsErrorDetails: sql<boolean>`COALESCE(${agentShares.shareConfig}->>'showErrorDetails' = 'true', false)`,
};

/** At most this many of a main view's threads' jobs still at work ride along with its own. */
const THREAD_ACTIVE_JOB_LIMIT = 50;

/**
 * A shared Agent runs under its owner's credentials, so its failure text can carry the owner's
 * provider or infrastructure diagnostics. The viewer of such a run is the visitor, who gets the
 * share page's projection (`sanitizeVisitorError`): a classified type, and the message only for
 * the few visitor-safe codes, unless the owner's share opts into `showErrorDetails`.
 */
const redactSharedRunError = <
  Job extends {
    errorMessage: string | null;
    errorType: string | null;
    sharedRun: boolean;
    shareShowsErrorDetails: boolean;
  },
>({
  sharedRun,
  shareShowsErrorDetails,
  ...job
}: Job) => {
  if (!sharedRun || job.errorMessage === null) return job;
  const safe = sanitizeVisitorError(
    { message: job.errorMessage, type: job.errorType ?? undefined } as ChatMessageError,
    { showErrorDetails: shareShowsErrorDetails },
  );
  return { ...job, errorMessage: safe?.message ?? null, errorType: safe?.type?.toString() ?? null };
};

const readJobs = async (tx: Transaction, where: SQL | undefined, limit: number) => {
  const rows = await tx
    .select(publicJobColumns)
    .from(channelJobs)
    .leftJoin(agentOperations, eq(agentOperations.id, channelJobs.operationId))
    .leftJoin(topics, eq(topics.id, channelJobs.topicId))
    .leftJoin(
      agentShares,
      sql`${agentShares.id}::text = ${channelJobs.executionConfig}->'share'->>'shareId'`,
    )
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
 * A view's jobs as one viewer sees them: who may stop each, and the run's topic only for the
 * viewer who runs the reply; for anyone else the job carries no topic at all.
 */
export const viewerJobs = (
  jobs: Awaited<ReturnType<typeof readChannelView>>['jobs'],
  viewerUserId: string,
  canStop: (requesterMemberId: string | null) => boolean,
) =>
  jobs.map(({ requesterMemberId, topicId, topicOwnerId, ...job }) => ({
    ...job,
    canStop: canStop(requesterMemberId),
    ...(topicId && topicOwnerId === viewerUserId ? { topicId } : {}),
  }));

export const readChannelView = async (
  tx: Transaction,
  channelId: string,
  options: { before?: number; limit?: number; threadId?: string | null } = {},
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
        userName: users.fullName,
        username: users.username,
        userAvatar: users.avatar,
        lastReadSequence: channelMembers.lastReadSequence,
        joinedAt: channelMembers.createdAt,
        deviceId: sql<string | null>`${channelMembers.config}->>'deviceId'`,
        deviceOwnerId: sql<string | null>`${channelMembers.config}->>'deviceOwnerId'`,
        workingDirectory: sql<string | null>`${channelMembers.config}->>'workingDirectory'`,
        agencyConfig: agents.agencyConfig,
        agentUserId: agents.userId,
        agentVisibility: agents.visibility,
        agentWorkspaceId: agents.workspaceId,
      })
      .from(channelMembers)
      .leftJoin(users, eq(users.id, channelMembers.userId))
      .leftJoin(agents, eq(agents.id, channelMembers.agentId))
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
      .where(and(eq(channelThreads.channelId, channelId), notTrashed(channelThreads.isDeleted)))
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
  const [sourceTopics, works, relayAvatars] = await Promise.all([
    sourceTopicsByMessage(tx, channelId, replyIds, viewerUserId),
    externalWorksByMessage(tx, channelId, replyIds),
    relayAgentAvatars(tx, [...page, ...(rootMessage ? [rootMessage] : [])]),
  ]);
  const ids = [...new Set([...files.values()].flat())];
  const attachments = ids.length
    ? await tx
        .select({
          id: fileTable.id,
          name: fileTable.name,
          fileType: fileTable.fileType,
          size: fileTable.size,
          url: fileTable.url,
        })
        .from(fileTable)
        .where(inArray(fileTable.id, ids))
    : [];
  return {
    attachments,
    hasMore: reversed.length > limit,
    jobs,
    members: environments.map((row) => {
      const {
        agencyConfig: _agencyConfig,
        agentUserId: _agentUserId,
        agentVisibility: _agentVisibility,
        agentWorkspaceId: _agentWorkspaceId,
        deviceId,
        deviceOwnerId: _deviceOwnerId,
        inheritedConfig,
        workingDirectory: channelDirectory,
        ...member
      } = row;
      const device = deviceInfos.get(row);
      // An inherited device works in the Agent's own folder there, else the device's default.
      const workingDirectory =
        inheritedConfig && deviceId
          ? (defaultChannelAgentDirectory(inheritedConfig, deviceId, device?.defaultCwd) ?? null)
          : channelDirectory;
      return {
        ...member,
        environment:
          member.agentId && (deviceId || workingDirectory)
            ? { deviceId, deviceName: device?.name ?? null, workingDirectory }
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
            publicMessage(rootMessage, files.get(rootMessage.id) ?? []),
            relayAvatars,
          ),
          sourceTopicId: sourceTopics.get(rootMessage.id)?.id ?? null,
          sourceTopicTitle: sourceTopics.get(rootMessage.id)?.title ?? null,
          works: works.get(rootMessage.id) ?? [],
          replyTo: rootMessage.replyToId ? (quotes.get(rootMessage.replyToId) ?? null) : null,
        }
      : null,
    messages: page.map((message) => ({
      ...withRelayAvatar(publicMessage(message, files.get(message.id) ?? []), relayAvatars),
      sourceTopicId: sourceTopics.get(message.id)?.id ?? null,
      sourceTopicTitle: sourceTopics.get(message.id)?.title ?? null,
      works: works.get(message.id) ?? [],
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

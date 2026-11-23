import type {
  ShareVisitorConversation,
  ShareVisitorIdentity,
  ShareVisitorTopic,
  ShareVisitorTopicGroup,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';

import { agents, agentShares, channelJobs, channels, topics, users } from '../../schemas';
import type { LobeChatDatabase, Transaction } from '../../type';
import { notTrashed } from '../../utils/softDelete';
import { channelLastMessages } from './lastMessage';
import { readChannelView, viewerJobs } from './view';

/** Visitor conversations one list returns; the Topics page shows them all at once. */
const SHARE_VISITOR_LIST_LIMIT = 200;

/**
 * Direct Channels visitors opened with `ownerId`'s shared Agent, while its share lets the creator
 * read them (`allowCreatorViewSessions`). Each visitor has one such Channel per scope.
 *
 * Admission follows each run's frozen share provenance (`executionConfig.share`, set at claim), not
 * the Agent's current visibility: a Workspace member's own conversation with a Workspace-visible
 * Agent runs as that member and must stay private even after the Agent is made private. A Channel
 * qualifies once a run went through the share and no claimed run ran outside it; unclaimed jobs
 * carry no config yet and do not count.
 */
const shareVisitorChannelWhere = (ownerId: string) =>
  and(
    eq(agents.userId, ownerId),
    isNotNull(channels.userId),
    ne(channels.userId, ownerId),
    notTrashed(channels.isDeleted),
    sql`${agentShares.shareConfig}->>'allowCreatorViewSessions' = 'true'`,
    sql`EXISTS (SELECT 1 FROM ${channelJobs} WHERE ${channelJobs.channelId} = ${channels.id} AND jsonb_typeof(${channelJobs.executionConfig}->'share') = 'object')`,
    sql`NOT EXISTS (SELECT 1 FROM ${channelJobs} WHERE ${channelJobs.channelId} = ${channels.id} AND ${channelJobs.executionConfig} IS NOT NULL AND coalesce(jsonb_typeof(${channelJobs.executionConfig}->'share'), 'null') <> 'object')`,
  );

const shareVisitorChannels = (db: LobeChatDatabase | Transaction) =>
  db
    .select({
      channel: channels,
      visitorAvatar: users.avatar,
      visitorName: users.fullName,
      visitorUsername: users.username,
    })
    .from(channels)
    .innerJoin(agents, eq(agents.id, channels.agentId))
    .innerJoin(agentShares, eq(agentShares.agentId, agents.id))
    .leftJoin(users, eq(users.id, channels.userId));

/**
 * Tokens and cost of the runs behind each Channel: every job's private run topic, counted once.
 * The run topics belong to the share's owner, who is the only reader of these totals.
 */
const runUsageByChannel = async (db: LobeChatDatabase, channelIds: string[]) => {
  if (!channelIds.length) return new Map<string, { totalCost: number; totalTokens: number }>();
  const runTopics = db
    .selectDistinct({ channelId: channelJobs.channelId, topicId: channelJobs.topicId })
    .from(channelJobs)
    .where(and(inArray(channelJobs.channelId, channelIds), isNotNull(channelJobs.topicId)))
    .as('run_topics');
  const rows = await db
    .select({
      channelId: runTopics.channelId,
      totalCost: sql<number>`coalesce(sum(${topics.totalCost}), 0)`.mapWith(Number),
      totalTokens: sql<number>`coalesce(sum(${topics.totalTokens}), 0)`.mapWith(Number),
    })
    .from(runTopics)
    .innerJoin(topics, eq(topics.id, runTopics.topicId))
    .groupBy(runTopics.channelId);
  return new Map(rows.map(({ channelId, ...usage }) => [channelId, usage]));
};

/** The visitor conversations with `ownerId`'s Agent the owner may read, newest first. */
export const listShareVisitorConversations = async (
  db: LobeChatDatabase,
  ownerId: string,
  agentId: string,
): Promise<ShareVisitorConversation[]> => {
  const rows = await shareVisitorChannels(db)
    .where(and(eq(channels.agentId, agentId), shareVisitorChannelWhere(ownerId)))
    .orderBy(desc(channels.updatedAt))
    .limit(SHARE_VISITOR_LIST_LIMIT);
  const ids = rows.map(({ channel }) => channel.id);
  const [lastMessages, usage] = await Promise.all([
    channelLastMessages(db, ids),
    runUsageByChannel(db, ids),
  ]);

  return rows.map(({ channel, visitorAvatar, visitorName, visitorUsername }) => ({
    createdAt: channel.createdAt,
    id: channel.id,
    lastMessage: lastMessages.get(channel.id) ?? null,
    totalCost: usage.get(channel.id)?.totalCost ?? 0,
    totalTokens: usage.get(channel.id)?.totalTokens ?? 0,
    updatedAt: channel.updatedAt,
    visitor: {
      avatar: visitorAvatar,
      id: channel.userId!,
      name: visitorName || visitorUsername,
    },
  }));
};

/** Characters of the visitor's first message kept to name an untitled run topic. */
const SHARE_VISITOR_TOPIC_PREVIEW_LENGTH = 100;

/**
 * Run topics behind the visitor Channels `ownerId` may read (see {@link shareVisitorChannelWhere}).
 * The topic belongs to the owner and records the visitor as its sender; both are checked so a
 * topic reached through a Channel job never widens into another user's topics.
 */
const shareVisitorTopics = (db: LobeChatDatabase | Transaction, ownerId: string, scope: SQL) =>
  db
    .selectDistinct({
      agentId: channels.agentId,
      topic: {
        createdAt: topics.createdAt,
        id: topics.id,
        // The Channel message that started the topic's first run: it exists from the claim on,
        // before the run writes its own copy into the topic.
        preview: sql<string | null>`(
          SELECT left(m.content, ${SHARE_VISITOR_TOPIC_PREVIEW_LENGTH})
          FROM channel_jobs j JOIN channel_messages m ON m.id = j.message_id
          WHERE j.topic_id = ${topics.id}
          ORDER BY m.created_at
          LIMIT 1
        )`,
        title: topics.title,
        totalCost: topics.totalCost,
        totalTokens: topics.totalTokens,
        updatedAt: topics.updatedAt,
      },
      visitorAvatar: users.avatar,
      visitorId: channels.userId,
      visitorName: users.fullName,
      visitorUsername: users.username,
    })
    .from(topics)
    .innerJoin(channelJobs, eq(channelJobs.topicId, topics.id))
    .innerJoin(channels, eq(channels.id, channelJobs.channelId))
    .innerJoin(agents, eq(agents.id, channels.agentId))
    .innerJoin(agentShares, eq(agentShares.agentId, agents.id))
    .leftJoin(users, eq(users.id, channels.userId))
    .where(
      and(
        scope,
        shareVisitorChannelWhere(ownerId),
        eq(topics.userId, ownerId),
        eq(topics.senderId, channels.userId),
        notTrashed(topics.isDeleted),
      ),
    );

/**
 * Topics one sidebar list returns across every visitor of an Agent, newest first. Older topics
 * beyond it drop out of the sidebar but still open from a link ({@link findShareVisitorTopic}).
 */
const SHARE_VISITOR_TOPIC_LIMIT = 500;

/**
 * The run topics of every visitor conversation with `ownerId`'s Agent the owner may read, grouped
 * by visitor. Visitors and their topics are both ordered by latest activity.
 */
export const listShareVisitorTopics = async (
  db: LobeChatDatabase,
  ownerId: string,
  agentId: string,
): Promise<ShareVisitorTopicGroup[]> => {
  const rows = await shareVisitorTopics(db, ownerId, eq(channels.agentId, agentId))
    .orderBy(desc(topics.updatedAt), desc(topics.id))
    .limit(SHARE_VISITOR_TOPIC_LIMIT);

  const groups = new Map<string, ShareVisitorTopicGroup>();
  for (const { topic, visitorAvatar, visitorId, visitorName, visitorUsername } of rows) {
    if (!visitorId) continue;
    let group = groups.get(visitorId);
    if (!group) {
      group = {
        topics: [],
        visitor: { avatar: visitorAvatar, id: visitorId, name: visitorName || visitorUsername },
      };
      groups.set(visitorId, group);
    }
    group.topics.push({
      ...topic,
      totalCost: Number(topic.totalCost ?? 0),
      totalTokens: topic.totalTokens ?? 0,
    });
  }
  return [...groups.values()];
};

/**
 * A visitor's run topic as the share's owner may open it, with the Agent and visitor it belongs to.
 * Undefined when `viewerId` may not read it.
 */
export const findShareVisitorTopic = async (
  db: LobeChatDatabase,
  viewerId: string,
  topicId: string,
): Promise<
  (ShareVisitorTopic & { agentId: string; visitor: ShareVisitorIdentity }) | undefined
> => {
  const [row] = await shareVisitorTopics(db, viewerId, eq(topics.id, topicId)).limit(1);
  if (!row?.visitorId || !row.agentId) return;
  return {
    ...row.topic,
    agentId: row.agentId,
    totalCost: Number(row.topic.totalCost ?? 0),
    totalTokens: row.topic.totalTokens ?? 0,
    visitor: {
      avatar: row.visitorAvatar,
      id: row.visitorId,
      name: row.visitorName || row.visitorUsername,
    },
  };
};

/**
 * A visitor's conversation as the share's owner reads it: the same public view the visitor sees,
 * read-only. Run topic links are left out — the owner's topic views exclude visitor topics, so
 * "open topic" would lead nowhere. Undefined when `viewerId` may not read it.
 */
export const readShareVisitorChannel = (
  db: LobeChatDatabase,
  viewerId: string,
  channelId: string,
  options?: Parameters<typeof readChannelView>[2],
) =>
  db.transaction(async (tx) => {
    const [found] = await shareVisitorChannels(tx)
      .where(and(eq(channels.id, channelId), shareVisitorChannelWhere(viewerId)))
      .limit(1);
    if (!found) return;

    const view = await readChannelView(tx, channelId, options, viewerId);
    const withoutTopic = <
      T extends { sourceTopicId: string | null; sourceTopicTitle: string | null },
    >(
      message: T,
    ) => ({ ...message, sourceTopicId: null, sourceTopicTitle: null });
    return {
      channel: {
        ...found.channel,
        canDelete: false,
        sharedAgent: true,
        // Every visitor's Channel is titled after the Agent; to its owner, the visitor names it.
        title: found.visitorName || found.visitorUsername || found.channel.title,
      },
      joined: false,
      readOnly: true as const,
      ...view,
      jobs: viewerJobs(view.jobs, viewerId, () => false).map(
        ({ topicId: _, topicTitle: __, ...job }) => job,
      ),
      messages: view.messages.map(withoutTopic),
      rootMessage: view.rootMessage && withoutTopic(view.rootMessage),
    };
  });

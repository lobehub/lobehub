import type {
  TopicPullRequestLinkSource,
  TopicPullRequestWork,
  WorkVersionMetadata,
} from '@lobechat/types';
import { and, desc, eq, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';

import { topics } from '../../schemas/topic';
import { works, workVersions } from '../../schemas/work';
import { notShareVisitorTopic } from '../../utils/shareVisitor';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { type WorkContext, workOwnership } from './context';

/** A topic links a handful of pull requests; this only bounds a runaway topic. */
const TOPIC_PULL_REQUEST_LIMIT = 50;

const pullRequestWorkScope = (ctx: WorkContext) =>
  and(
    workOwnership(ctx),
    eq(works.type, 'external'),
    eq(works.resourceType, 'github_pull_request'),
    isNotNull(works.resourceId),
  );

const linkedAt = sql<Date>`max(${workVersions.createdAt})`;
const workLinkOrder = [desc(linkedAt), desc(works.id)];

const parseIdentifier = (resourceId: string) => {
  const hash = resourceId.lastIndexOf('#');
  const number = Number(resourceId.slice(hash + 1));
  if (hash <= 0 || !Number.isInteger(number) || number <= 0) return null;
  return { number, repoFullName: resourceId.slice(0, hash) };
};

/**
 * GitHub pull requests linked to each of the given topics, most recently
 * linked first. A pull request is linked by ANY version of its Work registered
 * in the topic (any thread), so it shows once per topic however many commands
 * touched it, and a Work first registered elsewhere still appears once the
 * topic touches it. Topics without one are absent from the map.
 */
export const listTopicsPullRequests = async (
  ctx: WorkContext,
  topicIds: string[],
): Promise<Map<string, TopicPullRequestWork[]>> => {
  const result = new Map<string, TopicPullRequestWork[]>();
  if (topicIds.length === 0) return result;

  // How the topic came to it: an open command here (`gh pr create`) beats a
  // command naming it, which beats only ever having pushed to its branch.
  const created = sql<boolean>`bool_or(${workVersions.changeType} = 'created')`;
  const pushOnly = sql<boolean>`bool_and(coalesce(${workVersions.metadata} ->> 'pullRequestLink', '') = 'push')`;
  const links = ctx.db.$with('topic_pr_links').as(
    ctx.db
      .select({
        created: created.as('created'),
        currentVersionId: works.currentVersionId,
        linkedAt: linkedAt.as('linked_at'),
        pushOnly: pushOnly.as('push_only'),
        rank: sql<number>`row_number() over (
          partition by ${workVersions.topicId} order by ${sql.join(workLinkOrder, sql`, `)}
        )`.as('link_rank'),
        resourceId: works.resourceId,
        status: works.status,
        title: works.title,
        topicId: workVersions.topicId,
        url: works.url,
        workId: works.id,
      })
      .from(workVersions)
      .innerJoin(works, eq(workVersions.workId, works.id))
      .where(and(inArray(workVersions.topicId, topicIds), pullRequestWorkScope(ctx)))
      .groupBy(works.id, workVersions.topicId),
  );
  const rows = await ctx.db
    .with(links)
    .select()
    .from(links)
    .where(lte(links.rank, TOPIC_PULL_REQUEST_LIMIT))
    .orderBy(links.topicId, links.rank);

  const versionIds = [
    ...new Set(rows.map((row) => row.currentVersionId).filter((id): id is string => !!id)),
  ];
  // The current version carries the merged branch metadata (an edit that names
  // no branch keeps the one captured at create).
  const branches = new Map<string, WorkVersionMetadata | null>();
  if (versionIds.length > 0) {
    const versions = await ctx.db
      .select({ id: workVersions.id, metadata: workVersions.metadata })
      .from(workVersions)
      .where(inArray(workVersions.id, versionIds));
    for (const version of versions) branches.set(version.id, version.metadata);
  }

  for (const row of rows) {
    const identity = row.resourceId ? parseIdentifier(row.resourceId) : null;
    if (!identity || !row.topicId) continue;
    const metadata = row.currentVersionId ? branches.get(row.currentVersionId) : undefined;

    const list = result.get(row.topicId) ?? [];
    list.push({
      ...(metadata?.baseBranch ? { baseBranch: metadata.baseBranch } : {}),
      ...(metadata?.headBranch ? { headBranch: metadata.headBranch } : {}),
      identifier: row.resourceId!,
      // `max()` comes back as text through some drivers.
      linkedAt: new Date(row.linkedAt),
      number: identity.number,
      repoFullName: identity.repoFullName,
      source: (row.created
        ? 'created'
        : row.pushOnly
          ? 'push'
          : 'command') satisfies TopicPullRequestLinkSource,
      status: row.status,
      title: row.title,
      url: row.url,
      workId: row.workId,
    });
    result.set(row.topicId, list);
  }
  return result;
};

/** {@link listTopicsPullRequests} for one topic. */
export const listTopicPullRequests = async (
  ctx: WorkContext,
  topicId: string,
): Promise<TopicPullRequestWork[]> =>
  (await listTopicsPullRequests(ctx, [topicId])).get(topicId) ?? [];

/** Reverse the sidebar's persisted PR associations within the caller's scope. */
export const listTopicsByPullRequest = (ctx: WorkContext, identifier: string) => {
  const key = identifier.toLowerCase();
  const candidateTopics = ctx.db
    .select({ topicId: workVersions.topicId })
    .from(workVersions)
    .innerJoin(works, eq(workVersions.workId, works.id))
    .where(and(pullRequestWorkScope(ctx), eq(sql`lower(${works.resourceId})`, key)));

  // Rank only topics that touched this PR. The sidebar takes the latest 50
  // Work links per topic before adding metadata links and applying dismissals.
  const rankedLinks = ctx.db.$with('ranked_pr_links').as(
    ctx.db
      .select({
        rank: sql<number>`row_number() over (
          partition by ${workVersions.topicId} order by ${sql.join(workLinkOrder, sql`, `)}
        )`.as('link_rank'),
        resourceId: works.resourceId,
        topicId: workVersions.topicId,
      })
      .from(workVersions)
      .innerJoin(works, eq(workVersions.workId, works.id))
      .where(and(pullRequestWorkScope(ctx), inArray(workVersions.topicId, candidateTopics)))
      .groupBy(works.id, workVersions.topicId),
  );
  const workTopics = ctx.db
    .select({ topicId: rankedLinks.topicId })
    .from(rankedLinks)
    .where(
      and(
        eq(sql`lower(${rankedLinks.resourceId})`, key),
        lte(rankedLinks.rank, TOPIC_PULL_REQUEST_LIMIT),
      ),
    );

  const metadataLink = sql`exists (
    select 1 from jsonb_path_query(${topics.metadata}, '$.pullRequests.links[*]') as link(value)
    where lower(link.value ->> 'identifier') = ${key}
  )`;
  const dismissed = sql`exists (
    select 1 from jsonb_path_query(${topics.metadata}, '$.pullRequests.dismissed[*]') as item(value)
    where lower(item.value #>> '{}') = ${key}
  )`;

  return ctx.db
    .with(rankedLinks)
    .select({
      agentId: topics.agentId,
      groupId: topics.groupId,
      sessionId: topics.sessionId,
      title: topics.title,
      topicId: topics.id,
    })
    .from(topics)
    .where(
      and(
        buildWorkspaceWhere(ctx, topics),
        notShareVisitorTopic(),
        or(inArray(topics.id, workTopics), metadataLink),
        sql`not ${dismissed}`,
      ),
    )
    .orderBy(desc(topics.updatedAt), desc(topics.id));
};

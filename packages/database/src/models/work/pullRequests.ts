import type {
  TopicPullRequestLinkSource,
  TopicPullRequestWork,
  WorkVersionMetadata,
} from '@lobechat/types';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { works, workVersions } from '../../schemas/work';
import { type WorkContext, workOwnership } from './context';

/** A topic links a handful of pull requests; this only bounds a runaway topic. */
const TOPIC_PULL_REQUEST_LIMIT = 50;

const parseIdentifier = (resourceId: string) => {
  const hash = resourceId.lastIndexOf('#');
  const number = Number(resourceId.slice(hash + 1));
  if (hash <= 0 || !Number.isInteger(number) || number <= 0) return null;
  return { number, repoFullName: resourceId.slice(0, hash) };
};

/**
 * GitHub pull requests linked to a topic, most recently linked first. A pull
 * request is linked by ANY version of its Work registered in the topic (any
 * thread), so it shows once however many commands touched it, and a Work
 * first registered elsewhere still appears once the topic touches it.
 */
export const listTopicPullRequests = async (
  ctx: WorkContext,
  topicId: string,
): Promise<TopicPullRequestWork[]> => {
  const linkedAt = sql<Date>`max(${workVersions.createdAt})`;
  // How the topic came to it: an open command here (`gh pr create`) beats a
  // command naming it, which beats only ever having pushed to its branch.
  const created = sql<boolean>`bool_or(${workVersions.changeType} = 'created')`;
  const pushOnly = sql<boolean>`bool_and(coalesce(${workVersions.metadata} ->> 'pullRequestLink', '') = 'push')`;
  const rows = await ctx.db
    .select({
      created,
      currentVersionId: works.currentVersionId,
      linkedAt,
      pushOnly,
      resourceId: works.resourceId,
      status: works.status,
      title: works.title,
      url: works.url,
      workId: works.id,
    })
    .from(workVersions)
    .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
    .where(
      and(
        eq(workVersions.topicId, topicId),
        eq(works.type, 'external'),
        eq(works.resourceType, 'github_pull_request'),
        isNotNull(works.resourceId),
      ),
    )
    .groupBy(works.id)
    .orderBy(desc(linkedAt), desc(works.id))
    .limit(TOPIC_PULL_REQUEST_LIMIT);

  const versionIds = rows.map((row) => row.currentVersionId).filter((id): id is string => !!id);
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

  return rows.flatMap((row) => {
    const identity = row.resourceId ? parseIdentifier(row.resourceId) : null;
    if (!identity) return [];
    const metadata = row.currentVersionId ? branches.get(row.currentVersionId) : undefined;

    return [
      {
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
      },
    ];
  });
};

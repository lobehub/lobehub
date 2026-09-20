import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';

import type { ScmChangeRequestLinks } from '@/database/models/scm';
import { acceptances, verifyRuns, works } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

/**
 * Resolve which LobeHub records a provider change request belongs to. Three
 * sources, in order of trust:
 *
 * 1. The acceptance link the `pr` skill puts in the PR body
 *    (`…/acceptance/<uuid>`). Globally unique, no scope needed.
 * 2. The `external` Work the agent's `gh pr create` registered
 *    (`works.resourceId = owner/repo#number`). Gives topic + agent.
 * 3. The acceptance round that recorded this PR url in its coding context
 *    (`verify_runs.context.pullRequest.url`), written by `lh acceptance run ingest`.
 *
 * Every source is optional; the result only ever fills links, and the model
 * never clears one, so a later event with less context cannot undo a match.
 */

const ACCEPTANCE_LINK_RE =
  /\/acceptance\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi;

/** Acceptance ids mentioned in free text, de-duplicated in order of appearance. */
export const parseAcceptanceIds = (text: string | null | undefined): string[] => {
  if (!text) return [];
  const ids: string[] = [];
  for (const match of text.matchAll(ACCEPTANCE_LINK_RE)) {
    const id = match[1].toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
};

export interface ResolveLinksParams {
  body?: string | null;
  number: number;
  repoFullName: string;
  /** Scope of the installation the event came through; used to rank Work matches. */
  scope: { userId: string; workspaceId?: string | null };
  url: string;
}

export const resolveChangeRequestLinks = async (
  db: LobeChatDatabase,
  params: ResolveLinksParams,
): Promise<ScmChangeRequestLinks> => {
  const links: ScmChangeRequestLinks = {};

  // 1. Acceptance link in the body — first existing id wins.
  for (const id of parseAcceptanceIds(params.body)) {
    const [row] = await db
      .select({
        id: acceptances.id,
        subjectId: acceptances.subjectId,
        subjectType: acceptances.subjectType,
      })
      .from(acceptances)
      .where(eq(acceptances.id, id))
      .limit(1);
    if (row) {
      links.acceptanceId = row.id;
      if (row.subjectType === 'topic') links.topicId = row.subjectId;
      if (row.subjectType === 'task') links.taskId = row.subjectId;
      break;
    }
  }

  // 2. The registered Work. Prefer one in the installation's scope, then the newest.
  const resourceId = `${params.repoFullName}#${params.number}`;
  const scopeRank = params.scope.workspaceId
    ? sql<number>`CASE WHEN ${works.workspaceId} = ${params.scope.workspaceId} THEN 0 ELSE 1 END`
    : sql<number>`CASE WHEN ${works.userId} = ${params.scope.userId} AND ${works.workspaceId} IS NULL THEN 0 ELSE 1 END`;
  const [work] = await db
    .select({ id: works.id, originTopicId: works.originTopicId })
    .from(works)
    .where(and(eq(works.resourceType, 'github_pull_request'), eq(works.resourceId, resourceId)))
    .orderBy(scopeRank, desc(works.updatedAt))
    .limit(1);
  if (work) {
    links.workId = work.id;
    if (!links.topicId && work.originTopicId) links.topicId = work.originTopicId;
  }

  // 3. The acceptance round that ingested this PR url.
  if (!links.acceptanceId) {
    const [run] = await db
      .select({ acceptanceId: verifyRuns.acceptanceId })
      .from(verifyRuns)
      .where(
        and(
          isNotNull(verifyRuns.acceptanceId),
          sql`${verifyRuns.context} -> 'pullRequest' ->> 'url' = ${params.url}`,
        ),
      )
      .orderBy(desc(verifyRuns.createdAt))
      .limit(1);
    if (run?.acceptanceId) links.acceptanceId = run.acceptanceId;
  }

  return links;
};

import { and, desc, eq, isNotNull, isNull, type SQL, sql } from 'drizzle-orm';

import type { ScmChangeRequestLinks } from '@/database/models/scm';
import { acceptances, verifyRuns, works } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

/**
 * Resolve which LobeHub records a provider change request belongs to. Three
 * sources, in order of trust:
 *
 * 1. The acceptance link the `pr` skill puts in the PR body
 *    (`…/acceptance/<uuid>`).
 * 2. The `external` Work the agent's `gh pr create` registered
 *    (`works.resourceId = owner/repo#number`). Gives topic + agent.
 * 3. The acceptance round that recorded this PR url in its coding context
 *    (`verify_runs.context.pullRequest.url`), written by `lh acceptance run ingest`.
 *
 * Every source is confined to the tenant the installation is bound to: a
 * personal installation only sees that user's personal records, a workspace
 * installation only that workspace's. A PR body can name any acceptance id,
 * and without this fence a merge on an attacker's repository would accept
 * someone else's delivery.
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
  /** Scope of the installation the event came through; every source must match it exactly. */
  scope: { userId: string; workspaceId?: string | null };
  url: string;
}

/** Exact tenant match: the workspace, or the user's personal (workspace-less) records. */
const inScope = (
  table: { userId: SQL.Aliased | any; workspaceId: any },
  scope: ResolveLinksParams['scope'],
): SQL =>
  scope.workspaceId
    ? eq(table.workspaceId, scope.workspaceId)
    : and(eq(table.userId, scope.userId), isNull(table.workspaceId))!;

export const resolveChangeRequestLinks = async (
  db: LobeChatDatabase,
  params: ResolveLinksParams,
): Promise<ScmChangeRequestLinks> => {
  const links: ScmChangeRequestLinks = {};

  // 1. Acceptance link in the body — first id that exists in this scope wins.
  for (const id of parseAcceptanceIds(params.body)) {
    const [row] = await db
      .select({
        id: acceptances.id,
        subjectId: acceptances.subjectId,
        subjectType: acceptances.subjectType,
      })
      .from(acceptances)
      .where(and(eq(acceptances.id, id), inScope(acceptances, params.scope)))
      .limit(1);
    if (row) {
      links.acceptanceId = row.id;
      if (row.subjectType === 'topic') links.topicId = row.subjectId;
      if (row.subjectType === 'task') links.taskId = row.subjectId;
      break;
    }
  }

  // 2. The registered Work in this scope, newest first.
  const resourceId = `${params.repoFullName}#${params.number}`;
  const [work] = await db
    .select({ id: works.id, originTopicId: works.originTopicId })
    .from(works)
    .where(
      and(
        eq(works.resourceType, 'github_pull_request'),
        eq(works.resourceId, resourceId),
        inScope(works, params.scope),
      ),
    )
    .orderBy(desc(works.updatedAt))
    .limit(1);
  if (work) {
    links.workId = work.id;
    if (!links.topicId && work.originTopicId) links.topicId = work.originTopicId;
  }

  // 3. The acceptance round in this scope that ingested this PR url.
  if (!links.acceptanceId) {
    const [run] = await db
      .select({ acceptanceId: verifyRuns.acceptanceId })
      .from(verifyRuns)
      .where(
        and(
          isNotNull(verifyRuns.acceptanceId),
          inScope(verifyRuns, params.scope),
          sql`${verifyRuns.context} -> 'pullRequest' ->> 'url' = ${params.url}`,
        ),
      )
      .orderBy(desc(verifyRuns.createdAt))
      .limit(1);
    if (run?.acceptanceId) links.acceptanceId = run.acceptanceId;
  }

  return links;
};

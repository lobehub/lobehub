import type { ScmChangeRequestLinks } from '@lobechat/types';
import { and, desc, eq, inArray, isNotNull, isNull, or, type SQL, sql } from 'drizzle-orm';

import { ScmIdentityModel } from '@/database/models/scm';
import { acceptances, verifyRuns, works, workspaceMembers } from '@/database/schemas';
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
 * Every source is fenced, because a PR body can name any acceptance id and
 * without a fence a merge on an attacker's repository would accept someone
 * else's delivery. What the fence is depends on how much the provider tells
 * us — see {@link resolveChangeRequestOwner}.
 *
 * Every source is optional; the result only ever fills links, and the model
 * never clears one, so a later event with less context cannot undo a match.
 */

/** Ceiling on how many body ids one delivery may resolve; the body is user-controlled. */
const MAX_BODY_ACCEPTANCE_IDS = 20;

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

/**
 * Who a change request's links may be resolved against.
 *
 * - `author` — the provider named the pull request's author, and that
 *   account is linked to a LobeHub user. The strongest signal we get: it
 *   comes from a signature-verified webhook, not from text anyone can
 *   write, and it identifies the person whose agent opened the pull
 *   request. Their records are in scope wherever they live, so an agent
 *   does not have to belong to the workspace the installation is bound to.
 *   Nothing new is exposed either — the wake prompt carries job logs and
 *   review text the author can already read on the provider.
 * - `installation` — no author identity to go on (never linked, or a bot
 *   opened the pull request). Fall back to the tenant that owns the
 *   installation, which is all we can honestly claim.
 */
export type ScmLinkScope =
  | { kind: 'author'; userId: string }
  | { kind: 'installation'; userId: string; workspaceId?: string | null };

/** Resolve the pull request's author to a LobeHub user, when we know them. */
export const resolveChangeRequestOwner = async (
  db: LobeChatDatabase,
  params: {
    authorExternalId?: string | null;
    installation: { userId: string; workspaceId?: string | null };
    provider: 'github';
  },
): Promise<ScmLinkScope> => {
  if (params.authorExternalId) {
    const identity = await ScmIdentityModel.findByExternalUser(
      db,
      params.provider,
      params.authorExternalId,
    );
    if (identity) return { kind: 'author', userId: identity.userId };
  }
  return {
    kind: 'installation',
    userId: params.installation.userId,
    workspaceId: params.installation.workspaceId ?? null,
  };
};

export interface ResolveLinksParams {
  body?: string | null;
  number: number;
  repoFullName: string;
  /** Who the sources must belong to; see {@link ScmLinkScope}. */
  scope: ScmLinkScope;
  url: string;
}

export interface ResolvedChangeRequestLinks {
  links: ScmChangeRequestLinks;
  /**
   * Workspace the matched records live in, `null` when they are personal.
   * The change request follows them, so the conversation it links to is
   * looked up in the scope that actually holds it.
   */
  workspaceId: string | null;
}

/**
 * Not yet decided (`undefined`), personal (`null`), or one workspace.
 *
 * The first source that matches fixes this for the ones after it. Left
 * free, a body-named acceptance in workspace A and a Work in workspace B
 * could both match and the result would report only one of them — after
 * which the control half looks the other's topic up in the wrong scope and
 * silently finds nothing.
 */
type ScopePin = string | null | undefined;

const inScope = (
  db: LobeChatDatabase,
  table: { userId: SQL.Aliased | any; workspaceId: any },
  scope: ScmLinkScope,
  pin: ScopePin,
): SQL => {
  const pinned =
    pin === undefined
      ? undefined
      : pin === null
        ? isNull(table.workspaceId)
        : eq(table.workspaceId, pin);

  if (scope.kind === 'author') {
    // Everything this person owns, wherever they can still reach it. The
    // creator's id stays on a workspace record after they leave, so owning
    // it once is not enough — an active membership has to back it, or a
    // former member could still have an old workspace acceptance accepted
    // by merging a pull request.
    const memberOf = db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, scope.userId), isNull(workspaceMembers.deletedAt)));

    return and(
      eq(table.userId, scope.userId),
      or(isNull(table.workspaceId), inArray(table.workspaceId, memberOf)),
      pinned,
    )!;
  }

  return and(
    scope.workspaceId
      ? eq(table.workspaceId, scope.workspaceId)
      : and(eq(table.userId, scope.userId), isNull(table.workspaceId)),
    pinned,
  )!;
};

export const resolveChangeRequestLinks = async (
  db: LobeChatDatabase,
  params: ResolveLinksParams,
): Promise<ResolvedChangeRequestLinks> => {
  const links: ScmChangeRequestLinks = {};
  // Undecided until a source matches; from then on every later source has
  // to agree with it.
  let pin: ScopePin;

  // 1. Acceptance link in the body — first id that exists in this scope
  // wins. The body is user-controlled and may name a hundred ids, so they
  // are resolved in one query rather than one round trip each.
  const candidates = parseAcceptanceIds(params.body).slice(0, MAX_BODY_ACCEPTANCE_IDS);
  if (candidates.length > 0) {
    const rows = await db
      .select({
        id: acceptances.id,
        subjectId: acceptances.subjectId,
        subjectType: acceptances.subjectType,
        workspaceId: acceptances.workspaceId,
      })
      .from(acceptances)
      .where(and(inArray(acceptances.id, candidates), inScope(db, acceptances, params.scope, pin)));

    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of candidates) {
      const row = byId.get(id);
      if (!row) continue;
      links.acceptanceId = row.id;
      pin = row.workspaceId ?? null;
      if (row.subjectType === 'topic') links.topicId = row.subjectId;
      if (row.subjectType === 'task') links.taskId = row.subjectId;
      break;
    }
  }

  // 2. The registered Work in this scope, newest first.
  const resourceId = `${params.repoFullName}#${params.number}`;
  const [work] = await db
    .select({
      id: works.id,
      originTopicId: works.originTopicId,
      workspaceId: works.workspaceId,
    })
    .from(works)
    .where(
      and(
        eq(works.resourceType, 'github_pull_request'),
        eq(works.resourceId, resourceId),
        inScope(db, works, params.scope, pin),
      ),
    )
    .orderBy(desc(works.updatedAt))
    .limit(1);
  if (work) {
    links.workId = work.id;
    pin ??= work.workspaceId ?? null;
    if (!links.topicId && work.originTopicId) links.topicId = work.originTopicId;
  }

  // 3. The acceptance round in this scope that ingested this PR url.
  if (!links.acceptanceId) {
    const [run] = await db
      .select({ acceptanceId: verifyRuns.acceptanceId, workspaceId: verifyRuns.workspaceId })
      .from(verifyRuns)
      .where(
        and(
          isNotNull(verifyRuns.acceptanceId),
          inScope(db, verifyRuns, params.scope, pin),
          sql`${verifyRuns.context} -> 'pullRequest' ->> 'url' = ${params.url}`,
        ),
      )
      .orderBy(desc(verifyRuns.createdAt))
      .limit(1);
    if (run?.acceptanceId) {
      links.acceptanceId = run.acceptanceId;
      pin ??= run.workspaceId ?? null;
    }
  }

  return { links, workspaceId: pin ?? null };
};

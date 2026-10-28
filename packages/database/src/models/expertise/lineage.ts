import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import {
  documents,
  expertiseDomains,
  expertiseHits,
  expertiseLessons,
  expertiseRuns,
  topics,
  verifyCheckResults,
  verifyRuns,
} from '../../schemas';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { domainScopeWhere, type ExpertiseContext } from './context';

/**
 * The rejections one rule was distilled from, resolved back to the acceptance they were
 * written in so the reader can reopen the round and see the frame they circled.
 *
 * Evidence never changes hands: a hit stays on the lesson and the run that produced it, because
 * both are pinned to their domain by composite keys. So a rule that absorbed others
 * (`generalizedFromIds`) or was re-filed into another group (`salvagedFromId`) reads its sources
 * through that lineage instead of owning them.
 *
 * `sourceCheckResultId` is nullable by design — a deleted acceptance leaves the rule standing
 * and only breaks the trail — so the joins are left joins and the caller renders an unlinked
 * row rather than dropping the evidence.
 */
export const listLessonSources = async (ctx: ExpertiseContext, lessonId: string, limit = 20) => {
  const lineage = await resolveLineage(ctx, lessonId);
  if (lineage.length === 0) return [];
  return (
    ctx.db
      .select({
        acceptanceId: verifyRuns.acceptanceId,
        checkTitle: verifyCheckResults.checkItemTitle,
        createdAt: expertiseHits.createdAt,
        example: expertiseHits.example,
        // A material the reviewer brought: the document it was read from (a file is recorded as
        // its parsed document, which keeps the file id), and which kind of material it was.
        documentFileId: documents.fileId,
        documentId: documents.id,
        // Read from the run, not from the check-result join: a deleted acceptance leaves that
        // join empty, and the hit was still a rejection.
        fromAcceptance: sql<boolean>`coalesce(${expertiseRuns.reflectionKey}, '') like 'acceptance:%'`,
        materialType: sql<
          string | null
        >`case when ${expertiseRuns.reflectionKey} like 'material:%' then split_part(${expertiseRuns.reflectionKey}, ':', 2) end`,
        id: expertiseHits.id,
        // Where a conversation source can be reopened: the topic, the agent it lives under, and
        // the message the observation was read from when ingestion could find it.
        messageId: expertiseHits.sourceMessageId,
        reviewerComment: sql<string | null>`${verifyCheckResults.userDecisionDetail} ->> 'comment'`,
        roundIndex: verifyRuns.roundIndex,
        severity: expertiseHits.severity,
        topicAgentId: topics.agentId,
        topicId: topics.id,
        userDecision: expertiseHits.userDecision,
        where: expertiseHits.where,
      })
      .from(expertiseHits)
      .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseHits.domainId))
      .innerJoin(expertiseRuns, eq(expertiseRuns.id, expertiseHits.runId))
      // Only a topic the viewer can open: a shared group does not grant a teammate's topic.
      .leftJoin(
        topics,
        and(
          eq(expertiseRuns.subjectType, 'topic'),
          eq(topics.id, expertiseRuns.subjectId),
          buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, topics),
        ),
      )
      // Only a document the viewer can open, by the same scope documents are listed with.
      .leftJoin(
        documents,
        and(
          eq(expertiseRuns.subjectType, 'document'),
          eq(documents.id, expertiseRuns.subjectId),
          buildWorkspaceWhere({ userId: ctx.userId, workspaceId: ctx.workspaceId }, documents),
        ),
      )
      .leftJoin(verifyCheckResults, eq(verifyCheckResults.id, expertiseHits.sourceCheckResultId))
      .leftJoin(verifyRuns, eq(verifyRuns.id, verifyCheckResults.verifyRunId))
      .where(
        and(
          inArray(expertiseHits.lessonId, lineage),
          domainScopeWhere(ctx),
          // Access to a shared group is not access to the rounds behind it: a hit distilled from
          // a teammate's private round would otherwise show that round's check, the reviewer's
          // words and a link to it. Same predicate the consolidation reader applies.
          or(
            eq(verifyCheckResults.userId, ctx.userId),
            eq(verifyRuns.visibility, 'public'),
            // No linked round (never mapped, or the round was deleted): nothing says the viewer
            // may see where it came from, so only their own runs' evidence is shown.
            and(isNull(verifyCheckResults.id), eq(expertiseRuns.userId, ctx.userId)),
          ),
        ),
      )
      .orderBy(desc(expertiseHits.createdAt))
      .limit(limit)
  );
};

/**
 * Every lesson whose evidence this one now speaks for: itself, what it absorbed through merges
 * (`generalizedFromIds`) and what it was re-filed from (`salvagedFromId`), followed through as
 * many generations as there are. One level is not enough — merging a rule that was itself a
 * merge would otherwise keep the counts and lose the evidence.
 */
const resolveLineage = async (ctx: ExpertiseContext, lessonId: string): Promise<string[]> =>
  (await resolveLineages(ctx, [lessonId])).get(lessonId) ??
  /* v8 ignore start -- unreachable: the `[]` arm; resolveLineages maps every id it is given */
  [];
/* v8 ignore stop */

/**
 * {@link resolveLineage} for many rules at once: one read per generation instead of one walk
 * per rule, so a whole page of rules costs a handful of queries. A rule outside the caller's
 * scope maps to an empty lineage.
 */
const resolveLineages = async (ctx: ExpertiseContext, lessonIds: string[]) => {
  const parents = new Map<string, string[]>();
  let frontier = [...new Set(lessonIds)];
  // Bounded so a malformed cycle can never spin; real lineages are a handful of steps deep.
  for (let depth = 0; depth <= 16 && frontier.length > 0; depth += 1) {
    const rows = await ctx.db
      .select({
        generalizedFromIds: expertiseLessons.generalizedFromIds,
        id: expertiseLessons.id,
        salvagedFromId: expertiseLessons.salvagedFromId,
      })
      .from(expertiseLessons)
      .innerJoin(expertiseDomains, eq(expertiseDomains.id, expertiseLessons.domainId))
      .where(and(inArray(expertiseLessons.id, frontier), domainScopeWhere(ctx)));
    for (const row of rows) {
      parents.set(row.id, [
        ...(row.generalizedFromIds ?? []),
        ...(row.salvagedFromId ? [row.salvagedFromId] : []),
      ]);
    }
    frontier = [
      ...new Set(
        rows.flatMap(
          (row) =>
            parents.get(row.id) ??
            /* v8 ignore start -- unreachable: the `[]` arm; the loop above just set an entry for every row */
            [],
          /* v8 ignore stop */
        ),
      ),
    ].filter((id) => !parents.has(id));
  }

  return new Map(
    lessonIds.map((root) => {
      if (!parents.has(root)) return [root, []];
      const seen = new Set<string>([root]);
      const stack = [root];
      while (stack.length > 0) {
        for (const parent of parents.get(stack.pop()!) ?? []) {
          if (seen.has(parent)) continue;
          seen.add(parent);
          stack.push(parent);
        }
      }
      return [root, [...seen]];
    }),
  );
};

/**
 * How many times each rule's lineage was hit by a rejected acceptance versus observed in a
 * conversation. `hitCount` adds both, and the two mean different things to the reviewer: only
 * the first is "you rejected a delivery for this".
 */
export const countHitsBySource = async (ctx: ExpertiseContext, lessonIds: string[]) => {
  const lineages = await resolveLineages(ctx, lessonIds);
  const all = [...new Set([...lineages.values()].flat())];
  const rows =
    all.length === 0
      ? []
      : await ctx.db
          .select({
            conversations: sql<number>`count(*) filter (where coalesce(${expertiseRuns.reflectionKey}, '') not like 'acceptance:%' and coalesce(${expertiseRuns.reflectionKey}, '') not like 'material:%')::int`,
            lessonId: expertiseHits.lessonId,
            // Read from a material the reviewer brought: evidence the rule was stated, not seen.
            materials: sql<number>`count(*) filter (where ${expertiseRuns.reflectionKey} like 'material:%')::int`,
            rejections: sql<number>`count(*) filter (where ${expertiseRuns.reflectionKey} like 'acceptance:%')::int`,
          })
          .from(expertiseHits)
          .innerJoin(expertiseRuns, eq(expertiseRuns.id, expertiseHits.runId))
          .where(inArray(expertiseHits.lessonId, all))
          .groupBy(expertiseHits.lessonId);
  const byLesson = new Map(rows.map((row) => [row.lessonId, row]));

  return new Map(
    lessonIds.map((id) => {
      const lineage =
        lineages.get(id) ??
        /* v8 ignore start -- unreachable: the `[]` arm; resolveLineages maps every id in lessonIds */
        [];
      /* v8 ignore stop */
      const sum = (key: 'conversations' | 'materials' | 'rejections') =>
        lineage.reduce((total, member) => total + (byLesson.get(member)?.[key] ?? 0), 0);
      return [
        id,
        {
          conversationHitCount: sum('conversations'),
          materialHitCount: sum('materials'),
          rejectionHitCount: sum('rejections'),
        },
      ];
    }),
  );
};

/**
 * Distinct runs a lesson has been proven in across its whole lineage. Runs are "distinct
 * situations", so two merged rules hit in the same delivery count it once.
 */
export const countLineageRuns = async (ctx: ExpertiseContext, lessonId: string) => {
  const lineage = await resolveLineage(ctx, lessonId);
  if (lineage.length === 0) return 0;
  const [row] = await ctx.db
    .select({ runs: sql<number>`count(distinct ${expertiseHits.runId})::int` })
    .from(expertiseHits)
    .where(inArray(expertiseHits.lessonId, lineage));
  return row?.runs ?? 0;
};

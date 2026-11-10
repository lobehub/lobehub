import type {
  MemoryContextStory,
  MemoryContextStoryDossier,
  MemoryContextStoryList,
  MemoryContextStorySummary,
  UserMemoryDossierStatus,
} from '@lobechat/types';
import { and, desc, eq, inArray, isNotNull, isNull, type SQL, sql } from 'drizzle-orm';

import {
  topics,
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesDossiers,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { visibleMemoryState } from '../../utils/memoryVisibility';
import { notTrashed } from '../../utils/softDelete';

/** A heavy user has a few hundred contexts after consolidation; this is a safety net, not a page. */
const STORY_LIMIT = 500;
/** Evidence read for one context page; the dossiers' counts stay exact. */
const EVIDENCE_LIMIT = 1000;
/** Some users hold 100k+ legacy rows: counting stops here, the page only says "100+". */
export const LEGACY_COUNT_CAP = 100;

const DOSSIER_STATUSES = new Set<UserMemoryDossierStatus>(['active', 'dormant', 'closed']);

const toStatus = (value: string | null | undefined): UserMemoryDossierStatus =>
  value && DOSSIER_STATUSES.has(value as UserMemoryDossierStatus)
    ? (value as UserMemoryDossierStatus)
    : 'closed';

/**
 * Consolidated contexts as stories for the memory page: context → dossiers → evidence. Reads only
 * rows consolidation wrote (`synthesized_at` set); legacy per-topic contexts stay with the
 * existing list.
 */
export class UserMemoryContextStoryModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  private storyColumns = {
    firstSeenAt: userMemoriesContexts.firstSeenAt,
    id: userMemoriesContexts.id,
    lastEvidenceAt: userMemoriesContexts.lastEvidenceAt,
    nextSteps: userMemoriesContexts.nextSteps,
    now: userMemoriesContexts.now,
    openQuestions: userMemoriesContexts.openQuestions,
    status: userMemoriesContexts.currentStatus,
    title: userMemoriesContexts.title,
  };

  private storyWhere = (...extra: SQL[]) =>
    and(
      eq(userMemoriesContexts.userId, this.userId),
      // Consolidation always sets both. `last_evidence_at` keeps the read on the
      // `(user_id, last_evidence_at)` index instead of walking every legacy row of the user.
      isNotNull(userMemoriesContexts.lastEvidenceAt),
      isNotNull(userMemoriesContexts.synthesizedAt),
      notTrashed(userMemories.isDeleted),
      visibleMemoryState(userMemories.state),
      ...extra,
    );

  listStories = async (): Promise<MemoryContextStoryList> => {
    const counts = this.db
      .select({
        contextId: userMemoriesDossiers.contextId,
        dossierCount: sql<number>`count(*)::int`.as('dossier_count'),
        evidenceCount: sql<number>`coalesce(sum(${userMemoriesDossiers.activityCount}), 0)::int`.as(
          'evidence_count',
        ),
      })
      .from(userMemoriesDossiers)
      .where(
        and(
          eq(userMemoriesDossiers.userId, this.userId),
          isNotNull(userMemoriesDossiers.contextId),
        ),
      )
      .groupBy(userMemoriesDossiers.contextId)
      .as('counts');

    const [rows, legacyCount] = await Promise.all([
      this.db
        .select({
          ...this.storyColumns,
          dossierCount: counts.dossierCount,
          evidenceCount: counts.evidenceCount,
        })
        .from(userMemoriesContexts)
        .innerJoin(userMemories, eq(userMemories.id, userMemoriesContexts.userMemoryId))
        .leftJoin(counts, eq(counts.contextId, userMemoriesContexts.id))
        .where(this.storyWhere())
        .orderBy(desc(userMemoriesContexts.lastEvidenceAt))
        .limit(STORY_LIMIT),
      this.countLegacy(),
    ]);

    return {
      legacyCap: LEGACY_COUNT_CAP,
      legacyCount,
      stories: rows.map(({ dossierCount, evidenceCount, ...row }) =>
        this.toSummary(row, dossierCount ?? 0, evidenceCount ?? 0),
      ),
    };
  };

  getStory = async (contextId: string): Promise<MemoryContextStory | null> => {
    const [context] = await this.db
      .select(this.storyColumns)
      .from(userMemoriesContexts)
      .innerJoin(userMemories, eq(userMemories.id, userMemoriesContexts.userMemoryId))
      .where(this.storyWhere(eq(userMemoriesContexts.id, contextId)))
      .limit(1);
    if (!context) return null;

    const dossierRows = await this.db
      .select({
        activityCount: userMemoriesDossiers.activityCount,
        firstSeenAt: userMemoriesDossiers.firstSeenAt,
        id: userMemoriesDossiers.id,
        lastEvidenceAt: userMemoriesDossiers.lastEvidenceAt,
        now: userMemoriesDossiers.now,
        status: userMemoriesDossiers.status,
        title: userMemoriesDossiers.title,
      })
      .from(userMemoriesDossiers)
      .where(
        and(
          eq(userMemoriesDossiers.userId, this.userId),
          eq(userMemoriesDossiers.contextId, contextId),
        ),
      )
      .orderBy(sql`${userMemoriesDossiers.lastEvidenceAt} DESC NULLS LAST`);

    const evidenceRows =
      dossierRows.length === 0
        ? []
        : await this.db
            .select({
              capturedAt: userMemoriesActivities.capturedAt,
              dossierId: userMemoriesActivities.dossierId,
              id: userMemoriesActivities.id,
              narrative: userMemoriesActivities.narrative,
              sourceAgentId: topics.agentId,
              sourceTopicId: topics.id,
              sourceTopicTitle: topics.title,
              title: userMemories.title,
            })
            .from(userMemoriesActivities)
            .innerJoin(userMemories, eq(userMemories.id, userMemoriesActivities.userMemoryId))
            // Only the user's own topic that still exists, so every link opens.
            .leftJoin(
              topics,
              and(
                eq(topics.id, sql`${userMemoriesActivities.metadata} ->> 'sourceId'`),
                eq(topics.userId, this.userId),
              ),
            )
            .where(
              and(
                eq(userMemoriesActivities.userId, this.userId),
                inArray(
                  userMemoriesActivities.dossierId,
                  dossierRows.map((d) => d.id),
                ),
                notTrashed(userMemories.isDeleted),
                visibleMemoryState(userMemories.state),
              ),
            )
            .orderBy(desc(userMemoriesActivities.capturedAt))
            .limit(EVIDENCE_LIMIT);

    const evidenceOf = new Map<string, MemoryContextStoryDossier['evidence']>();
    for (const { dossierId, ...row } of evidenceRows) {
      if (!dossierId) continue;
      const list = evidenceOf.get(dossierId) ?? [];
      list.push({ ...row, dossierId });
      evidenceOf.set(dossierId, list);
    }

    const dossiers = dossierRows.map((d) => ({
      ...d,
      evidence: evidenceOf.get(d.id) ?? [],
      status: toStatus(d.status),
    }));

    return {
      ...this.toSummary(
        context,
        dossiers.length,
        dossiers.reduce((sum, d) => sum + d.activityCount, 0),
      ),
      dossiers,
    };
  };

  /**
   * Legacy per-topic contexts readers still see (not filed as evidence by consolidation), counted
   * up to `LEGACY_COUNT_CAP`.
   */
  countLegacy = async (): Promise<number> => {
    const capped = this.db
      .select({ one: sql`1` })
      .from(userMemoriesContexts)
      .innerJoin(
        userMemories,
        sql`${userMemories.id} = COALESCE(${userMemoriesContexts.userMemoryId}, ${userMemoriesContexts.userMemoryIds} ->> 0)`,
      )
      .where(
        and(
          eq(userMemoriesContexts.userId, this.userId),
          isNull(userMemoriesContexts.synthesizedAt),
          notTrashed(userMemories.isDeleted),
          visibleMemoryState(userMemories.state),
        ),
      )
      .limit(LEGACY_COUNT_CAP)
      .as('capped');

    const [row] = await this.db.select({ count: sql<number>`count(*)::int` }).from(capped);
    return row?.count ?? 0;
  };

  private toSummary = (
    row: {
      firstSeenAt: Date | null;
      id: string;
      lastEvidenceAt: Date | null;
      nextSteps: string[] | null;
      now: string | null;
      openQuestions: string[] | null;
      status: string | null;
      title: string | null;
    },
    dossierCount: number,
    evidenceCount: number,
  ): MemoryContextStorySummary => ({
    ...row,
    dossierCount,
    evidenceCount,
    nextSteps: row.nextSteps ?? [],
    openQuestions: row.openQuestions ?? [],
    status: toStatus(row.status),
  });
}

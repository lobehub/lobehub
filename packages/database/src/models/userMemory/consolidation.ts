import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import {
  userMemories,
  userMemoriesActivities,
  userMemoriesContexts,
  userMemoriesDossiers,
  userMemoriesOperations,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { notTrashed } from '../../utils/softDelete';

/**
 * Memory consolidation: the per-topic context rows written by extraction are evidence. The
 * consolidation pipeline groups them into contexts (a project direction / customer / company
 * matter) and dossiers (one feature, deal or ongoing sub-task), and turns each evidence row into an
 * activity under its dossier. Nothing is deleted: the legacy row's parent memory is marked
 * `superseded` (hidden from reads) and every write carries the run id, so a run can be reverted.
 */

export type ConsolidationRoute = 'drop' | 'evidence' | 'fact' | 'preference';

export interface LegacyContextItem {
  associatedObjects: { name?: string; type?: string }[] | null;
  associatedSubjects: { name?: string; type?: string }[] | null;
  capturedAt: Date;
  description: string | null;
  id: string;
  memoryId: string;
  sourceId: string | null;
  title: string | null;
}

export interface ConsolidatedDossierSummary {
  activityCount: number;
  contextId: string | null;
  id: string;
  lastEvidenceAt: Date | null;
  now: string | null;
  title: string | null;
}

export interface ConsolidatedContextSummary {
  id: string;
  lastEvidenceAt: Date | null;
  now: string | null;
  title: string | null;
}

export interface ConsolidationDossierPlan {
  /** Existing dossier to extend; omitted for a new one. */
  existingDossierId?: string;
  /** Legacy context ids (evidence) filed under this dossier. */
  memberIds: string[];
  now: string;
  title: string;
}

export interface ConsolidationContextPlan {
  dossiers: ConsolidationDossierPlan[];
  /** Existing consolidated context to extend; omitted for a new one. */
  existingContextId?: string;
  nextSteps: string[];
  now: string;
  openQuestions: string[];
  title: string;
}

export interface ConsolidationApplyResult {
  activities: number;
  contextId?: string;
  contextsCreated: number;
  contextsUpdated: number;
  dossierIds: string[];
  dossiersCreated: number;
  dossiersUpdated: number;
}

const DAY_MS = 86_400_000;

/** Derived from the newest evidence, never from what an extractor wrote. */
export const deriveContextStatus = (lastEvidenceAt: Date, now = new Date()) => {
  const gap = (now.getTime() - lastEvidenceAt.getTime()) / DAY_MS;
  if (gap <= 45) return 'active';
  if (gap <= 150) return 'dormant';
  return 'closed';
};

const runTag = (runId: string) => ({ consolidationRunId: runId });

/**
 * Users that have been consolidated at least once, so the nightly run can keep them current.
 * Reads the dossiers table (new and small), not the large contexts table.
 */
export const listConsolidatedUserIds = async (db: LobeChatDatabase): Promise<string[]> => {
  const rows = await db
    .selectDistinct({ userId: userMemoriesDossiers.userId })
    .from(userMemoriesDossiers)
    .where(isNotNull(userMemoriesDossiers.userId));
  return rows.map((r) => r.userId).filter((id): id is string => !!id);
};

export class UserMemoryConsolidationModel {
  private readonly db: LobeChatDatabase;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  /**
   * Legacy per-topic contexts not yet seen by consolidation, oldest first. A legacy context has no
   * single parent (`user_memory_id`); its parent is the first id of `user_memory_ids`.
   */
  listPendingLegacyContexts = async (limit = 5000): Promise<LegacyContextItem[]> => {
    const rows = await this.db
      .select({
        associatedObjects: userMemoriesContexts.associatedObjects,
        associatedSubjects: userMemoriesContexts.associatedSubjects,
        capturedAt: userMemoriesContexts.capturedAt,
        description: userMemoriesContexts.description,
        id: userMemoriesContexts.id,
        memoryId: userMemories.id,
        memoryMetadata: userMemories.metadata,
        title: userMemoriesContexts.title,
      })
      .from(userMemoriesContexts)
      .innerJoin(
        userMemories,
        sql`${userMemories.id} = ${userMemoriesContexts.userMemoryIds} ->> 0`,
      )
      .where(
        and(
          eq(userMemoriesContexts.userId, this.userId),
          isNull(userMemoriesContexts.userMemoryId),
          eq(userMemories.userId, this.userId),
          notTrashed(userMemories.isDeleted),
          isNull(userMemories.state),
          sql`(${userMemories.metadata} -> 'consolidation') IS NULL`,
        ),
      )
      .orderBy(asc(userMemoriesContexts.capturedAt), asc(userMemoriesContexts.id))
      .limit(limit);

    return rows.map(({ memoryMetadata, ...row }) => ({
      ...row,
      sourceId: typeof memoryMetadata?.sourceId === 'string' ? memoryMetadata.sourceId : null,
    }));
  };

  getLegacyContextsByIds = async (ids: string[]): Promise<LegacyContextItem[]> => {
    if (ids.length === 0) return [];
    const items = await this.db
      .select({
        associatedObjects: userMemoriesContexts.associatedObjects,
        associatedSubjects: userMemoriesContexts.associatedSubjects,
        capturedAt: userMemoriesContexts.capturedAt,
        description: userMemoriesContexts.description,
        id: userMemoriesContexts.id,
        memoryId: userMemories.id,
        memoryMetadata: userMemories.metadata,
        title: userMemoriesContexts.title,
      })
      .from(userMemoriesContexts)
      .innerJoin(
        userMemories,
        sql`${userMemories.id} = ${userMemoriesContexts.userMemoryIds} ->> 0`,
      )
      .where(
        and(eq(userMemoriesContexts.userId, this.userId), inArray(userMemoriesContexts.id, ids)),
      );

    return items.map(({ memoryMetadata, ...row }) => ({
      ...row,
      sourceId: typeof memoryMetadata?.sourceId === 'string' ? memoryMetadata.sourceId : null,
    }));
  };

  /** Consolidated contexts (they have a single parent) with their dossiers, for the online step. */
  listConsolidated = async (): Promise<{
    contexts: ConsolidatedContextSummary[];
    dossiers: ConsolidatedDossierSummary[];
  }> => {
    const [contexts, dossiers] = await Promise.all([
      this.db
        .select({
          id: userMemoriesContexts.id,
          lastEvidenceAt: userMemoriesContexts.lastEvidenceAt,
          now: userMemoriesContexts.now,
          title: userMemoriesContexts.title,
        })
        .from(userMemoriesContexts)
        .innerJoin(userMemories, eq(userMemories.id, userMemoriesContexts.userMemoryId))
        .where(
          and(
            eq(userMemoriesContexts.userId, this.userId),
            isNotNull(userMemoriesContexts.userMemoryId),
            notTrashed(userMemories.isDeleted),
          ),
        ),
      this.db
        .select({
          activityCount: userMemoriesDossiers.activityCount,
          contextId: userMemoriesDossiers.contextId,
          id: userMemoriesDossiers.id,
          lastEvidenceAt: userMemoriesDossiers.lastEvidenceAt,
          now: userMemoriesDossiers.now,
          title: userMemoriesDossiers.title,
        })
        .from(userMemoriesDossiers)
        .where(eq(userMemoriesDossiers.userId, this.userId)),
    ]);

    return { contexts, dossiers };
  };

  /** Recent evidence titles per dossier, to show the model what a dossier already holds. */
  listDossierEvidenceTitles = async (dossierIds: string[], perDossier = 3) => {
    if (dossierIds.length === 0) return {} as Record<string, string[]>;
    const rows = await this.db
      .select({ dossierId: userMemoriesActivities.dossierId, title: userMemories.title })
      .from(userMemoriesActivities)
      .innerJoin(userMemories, eq(userMemories.id, userMemoriesActivities.userMemoryId))
      .where(
        and(
          eq(userMemoriesActivities.userId, this.userId),
          inArray(userMemoriesActivities.dossierId, dossierIds),
        ),
      )
      .orderBy(sql`${userMemoriesActivities.capturedAt} DESC`);

    const out: Record<string, string[]> = {};
    for (const row of rows) {
      if (!row.dossierId || !row.title) continue;
      const list = (out[row.dossierId] ??= []);
      if (list.length < perDossier) list.push(row.title);
    }
    return out;
  };

  /**
   * Record a stage decision on the legacy rows (their parent memory's metadata), so later workflow
   * steps read it back from the database instead of carrying it in step results.
   */
  enqueue = async (
    runId: string,
    entries: { id: string; key: string; route: ConsolidationRoute }[],
  ) => {
    if (entries.length === 0) return;
    const items = await this.getLegacyContextsByIds(entries.map((e) => e.id));
    const parentOf = new Map(items.map((i) => [i.id, i.memoryId]));
    await this.db.transaction(async (tx) => {
      for (const e of entries) {
        const memoryId = parentOf.get(e.id);
        if (!memoryId) continue;
        await tx
          .update(userMemories)
          .set({
            metadata: sql`coalesce(${userMemories.metadata}, '{}'::jsonb) || ${JSON.stringify({
              consolidationQueue: { key: e.key, route: e.route, runId },
            })}::jsonb`,
          })
          .where(and(eq(userMemories.id, memoryId), eq(userMemories.userId, this.userId)));
      }
    });
  };

  /** Evidence queued by `runId` and not yet filed, with its queue key (domain or context). */
  listQueued = async (runId: string): Promise<{ capturedAt: Date; id: string; key: string }[]> => {
    const rows = await this.db
      .select({
        capturedAt: userMemoriesContexts.capturedAt,
        id: userMemoriesContexts.id,
        key: sql<string>`${userMemories.metadata} -> 'consolidationQueue' ->> 'key'`,
      })
      .from(userMemoriesContexts)
      .innerJoin(
        userMemories,
        sql`${userMemories.id} = ${userMemoriesContexts.userMemoryIds} ->> 0`,
      )
      .where(
        and(
          eq(userMemoriesContexts.userId, this.userId),
          isNull(userMemoriesContexts.userMemoryId),
          eq(userMemories.userId, this.userId),
          isNull(userMemories.state),
          sql`(${userMemories.metadata} -> 'consolidation') IS NULL`,
          sql`${userMemories.metadata} -> 'consolidationQueue' ->> 'runId' = ${runId}`,
          sql`${userMemories.metadata} -> 'consolidationQueue' ->> 'route' = 'evidence'`,
        ),
      )
      .orderBy(asc(userMemoriesContexts.capturedAt), asc(userMemoriesContexts.id));
    return rows;
  };

  /** Mark legacy rows that consolidation saw but keeps in place (facts, preferences, noise). */
  markRouted = async (runId: string, routes: Record<string, ConsolidationRoute>) => {
    const ids = Object.keys(routes);
    if (ids.length === 0) return;
    const items = await this.getLegacyContextsByIds(ids);
    await this.db.transaction(async (tx) => {
      for (const item of items) {
        await tx
          .update(userMemories)
          .set({
            metadata: sql`coalesce(${userMemories.metadata}, '{}'::jsonb) || ${JSON.stringify({
              consolidation: { route: routes[item.id], runId },
            })}::jsonb`,
          })
          .where(and(eq(userMemories.id, item.memoryId), eq(userMemories.userId, this.userId)));
      }
    });
  };

  /**
   * Write one context plan: create or extend the context and its dossiers, turn every member into
   * an activity under its dossier, and supersede the legacy rows. One transaction per context.
   */
  applyContextPlan = async (
    runId: string,
    plan: ConsolidationContextPlan,
  ): Promise<ConsolidationApplyResult> => {
    const memberIds = plan.dossiers.flatMap((d) => d.memberIds);
    const items = await this.getLegacyContextsByIds(memberIds);
    const byId = new Map(items.map((i) => [i.id, i]));
    const vectors = await this.db
      .select({ id: userMemoriesContexts.id, vector: userMemoriesContexts.descriptionVector })
      .from(userMemoriesContexts)
      .where(
        and(
          eq(userMemoriesContexts.userId, this.userId),
          inArray(userMemoriesContexts.id, memberIds),
        ),
      );
    const vectorById = new Map(vectors.map((v) => [v.id, v.vector]));
    const result: ConsolidationApplyResult = {
      activities: 0,
      dossierIds: [],
      contextsCreated: 0,
      contextsUpdated: 0,
      dossiersCreated: 0,
      dossiersUpdated: 0,
    };

    const placed = plan.dossiers
      .map((d) => ({
        ...d,
        members: d.memberIds.map((id) => byId.get(id)).filter((i): i is LegacyContextItem => !!i),
      }))
      .filter((d) => d.members.length > 0);
    if (placed.length === 0) return result;

    const allDates = placed.flatMap((d) => d.members.map((m) => m.capturedAt.getTime()));
    const firstSeen = new Date(Math.min(...allDates));
    const lastEvidence = new Date(Math.max(...allDates));
    const now = new Date();

    await this.db.transaction(async (tx) => {
      const op = (
        values: Omit<
          typeof userMemoriesOperations.$inferInsert,
          'actor' | 'gate' | 'state' | 'userId'
        >,
      ) =>
        tx.insert(userMemoriesOperations).values({
          actor: 'pipeline',
          gate: 'auto',
          state: 'applied',
          userId: this.userId,
          ...values,
          metadata: { ...values.metadata, ...runTag(runId) },
        });

      // ----- context -----
      let contextId = plan.existingContextId;
      if (contextId) {
        const [before] = await tx
          .select({
            firstSeenAt: userMemoriesContexts.firstSeenAt,
            lastEvidenceAt: userMemoriesContexts.lastEvidenceAt,
            nextSteps: userMemoriesContexts.nextSteps,
            now: userMemoriesContexts.now,
            openQuestions: userMemoriesContexts.openQuestions,
          })
          .from(userMemoriesContexts)
          .where(
            and(
              eq(userMemoriesContexts.id, contextId),
              eq(userMemoriesContexts.userId, this.userId),
            ),
          );
        if (!before) {
          contextId = undefined;
        } else {
          const last =
            before.lastEvidenceAt && before.lastEvidenceAt > lastEvidence
              ? before.lastEvidenceAt
              : lastEvidence;
          await tx
            .update(userMemoriesContexts)
            .set({
              currentStatus: deriveContextStatus(last, now),
              description: plan.now,
              lastEvidenceAt: last,
              nextSteps: plan.nextSteps,
              now: plan.now,
              openQuestions: plan.openQuestions,
              synthesizedAt: now,
              updatedAt: now,
            })
            .where(eq(userMemoriesContexts.id, contextId));
          await op({
            after: { nextSteps: plan.nextSteps, now: plan.now, openQuestions: plan.openQuestions },
            before,
            op: 'status',
            targets: { context: contextId },
          });
          result.contextsUpdated += 1;
        }
      }
      if (!contextId) {
        const [memory] = await tx
          .insert(userMemories)
          .values({
            capturedAt: now,
            lastAccessedAt: now,
            memoryCategory: 'context',
            memoryLayer: 'context',
            memoryType: 'context',
            metadata: runTag(runId),
            state: 'active',
            summary: plan.now,
            title: plan.title.slice(0, 255),
            userId: this.userId,
          })
          .returning({ id: userMemories.id });
        const [created] = await tx
          .insert(userMemoriesContexts)
          .values({
            capturedAt: now,
            currentStatus: deriveContextStatus(lastEvidence, now),
            description: plan.now,
            firstSeenAt: firstSeen,
            lastEvidenceAt: lastEvidence,
            metadata: runTag(runId),
            nextSteps: plan.nextSteps,
            now: plan.now,
            openQuestions: plan.openQuestions,
            synthesizedAt: now,
            title: plan.title,
            userId: this.userId,
            userMemoryId: memory.id,
            userMemoryIds: [],
          })
          .returning({ id: userMemoriesContexts.id });
        contextId = created.id;
        await op({ after: { title: plan.title }, op: 'create', targets: { context: contextId } });
        result.contextsCreated += 1;
      }

      // ----- dossiers + evidence -----
      for (const d of placed) {
        const dates = d.members.map((m) => m.capturedAt.getTime());
        const dFirst = new Date(Math.min(...dates));
        const dLast = new Date(Math.max(...dates));
        let dossierId = d.existingDossierId;
        if (dossierId) {
          const [existing] = await tx
            .select({
              activityCount: userMemoriesDossiers.activityCount,
              lastEvidenceAt: userMemoriesDossiers.lastEvidenceAt,
              now: userMemoriesDossiers.now,
            })
            .from(userMemoriesDossiers)
            .where(
              and(
                eq(userMemoriesDossiers.id, dossierId),
                eq(userMemoriesDossiers.userId, this.userId),
              ),
            );
          if (!existing) dossierId = undefined;
          else {
            await tx
              .update(userMemoriesDossiers)
              .set({
                activityCount: existing.activityCount + d.members.length,
                lastEvidenceAt:
                  existing.lastEvidenceAt && existing.lastEvidenceAt > dLast
                    ? existing.lastEvidenceAt
                    : dLast,
                now: d.now,
                summary: d.now,
                updatedAt: now,
              })
              .where(eq(userMemoriesDossiers.id, dossierId));
            await op({
              after: { now: d.now },
              before: { activityCount: existing.activityCount, now: existing.now },
              op: 'status',
              targets: { dossier: dossierId },
            });
            result.dossiersUpdated += 1;
          }
        }
        if (!dossierId) {
          const [memory] = await tx
            .insert(userMemories)
            .values({
              capturedAt: now,
              lastAccessedAt: now,
              memoryCategory: 'context',
              memoryLayer: 'dossier',
              memoryType: 'dossier',
              metadata: runTag(runId),
              state: 'active',
              summary: d.now,
              title: d.title.slice(0, 255),
              userId: this.userId,
            })
            .returning({ id: userMemories.id });
          const [created] = await tx
            .insert(userMemoriesDossiers)
            .values({
              activityCount: d.members.length,
              contextId,
              firstSeenAt: dFirst,
              lastEvidenceAt: dLast,
              metadata: runTag(runId),
              now: d.now,
              status: deriveContextStatus(dLast, now),
              summary: d.now,
              title: d.title,
              userId: this.userId,
              userMemoryId: memory.id,
            })
            .returning({ id: userMemoriesDossiers.id });
          dossierId = created.id;
          await op({
            after: { title: d.title },
            op: 'create',
            targets: { context: contextId, dossier: dossierId },
          });
          result.dossiersCreated += 1;
        }

        result.dossierIds.push(dossierId);
        const activityIds: string[] = [];
        for (const m of d.members) {
          const meta = {
            ...runTag(runId),
            legacyContextId: m.id,
            legacyMemoryId: m.memoryId,
            ...(m.sourceId ? { sourceId: m.sourceId } : {}),
          };
          const [memory] = await tx
            .insert(userMemories)
            .values({
              capturedAt: m.capturedAt,
              details: m.description,
              lastAccessedAt: now,
              memoryCategory: 'activity',
              memoryLayer: 'activity',
              memoryType: 'activity',
              metadata: meta,
              state: 'active',
              summary: m.description?.slice(0, 1000) ?? null,
              title: (m.title ?? '').slice(0, 255) || null,
              userId: this.userId,
            })
            .returning({ id: userMemories.id });
          const [activity] = await tx
            .insert(userMemoriesActivities)
            .values({
              associatedObjects: (m.associatedObjects ?? []) as never,
              associatedSubjects: (m.associatedSubjects ?? []) as never,
              capturedAt: m.capturedAt,
              dossierId,
              injectable: true,
              metadata: meta,
              narrative: m.description,
              narrativeVector: vectorById.get(m.id) ?? null,
              status: 'completed',
              type: 'context_evidence',
              userId: this.userId,
              userMemoryId: memory.id,
            })
            .returning({ id: userMemoriesActivities.id });
          activityIds.push(activity.id);
          await tx
            .update(userMemories)
            .set({
              metadata: sql`coalesce(${userMemories.metadata}, '{}'::jsonb) || ${JSON.stringify({
                consolidation: { activityId: activity.id, route: 'evidence', runId },
              })}::jsonb`,
              state: 'superseded',
              updatedAt: now,
            })
            .where(and(eq(userMemories.id, m.memoryId), eq(userMemories.userId, this.userId)));
          result.activities += 1;
        }
        await op({ op: 'attach', targets: { activities: activityIds, dossier: dossierId } });
      }
      result.contextId = contextId;
    });

    return result;
  };

  /**
   * Undo a run: delete the memories it created (children cascade) and bring the legacy rows back.
   * In-place updates of pre-existing contexts / dossiers are restored from the operation log.
   */
  revertRun = async (runId: string) => {
    return this.db.transaction(async (tx) => {
      const updates = await tx
        .select()
        .from(userMemoriesOperations)
        .where(
          and(
            eq(userMemoriesOperations.userId, this.userId),
            eq(userMemoriesOperations.op, 'status'),
            eq(userMemoriesOperations.state, 'applied'),
            sql`${userMemoriesOperations.metadata} ->> 'consolidationRunId' = ${runId}`,
          ),
        );
      for (const u of updates) {
        const before = (u.before ?? {}) as Record<string, unknown>;
        const target = u.targets as Record<string, string>;
        if (target.context && !target.dossier) {
          await tx
            .update(userMemoriesContexts)
            .set({
              lastEvidenceAt: before.lastEvidenceAt
                ? new Date(before.lastEvidenceAt as string)
                : null,
              nextSteps: (before.nextSteps as string[]) ?? null,
              now: (before.now as string) ?? null,
              openQuestions: (before.openQuestions as string[]) ?? null,
            })
            .where(
              and(
                eq(userMemoriesContexts.id, target.context),
                eq(userMemoriesContexts.userId, this.userId),
              ),
            );
        } else if (target.dossier) {
          await tx
            .update(userMemoriesDossiers)
            .set({
              activityCount: Number(before.activityCount ?? 0),
              now: (before.now as string) ?? null,
            })
            .where(
              and(
                eq(userMemoriesDossiers.id, target.dossier),
                eq(userMemoriesDossiers.userId, this.userId),
              ),
            );
        }
      }
      const deleted = await tx
        .delete(userMemories)
        .where(
          and(
            eq(userMemories.userId, this.userId),
            sql`${userMemories.metadata} ->> 'consolidationRunId' = ${runId}`,
          ),
        )
        .returning({ id: userMemories.id });
      const restored = await tx
        .update(userMemories)
        .set({
          metadata: sql`${userMemories.metadata} - 'consolidation' - 'consolidationQueue'`,
          state: null,
        })
        .where(
          and(
            eq(userMemories.userId, this.userId),
            sql`(${userMemories.metadata} -> 'consolidation' ->> 'runId' = ${runId} OR ${userMemories.metadata} -> 'consolidationQueue' ->> 'runId' = ${runId})`,
          ),
        )
        .returning({ id: userMemories.id });
      await tx
        .update(userMemoriesOperations)
        .set({ resolvedAt: new Date(), state: 'reverted' })
        .where(
          and(
            eq(userMemoriesOperations.userId, this.userId),
            sql`${userMemoriesOperations.metadata} ->> 'consolidationRunId' = ${runId}`,
          ),
        );
      return { deleted: deleted.length, restored: restored.length };
    });
  };
}

import type {
  ScmApplyChecksParams,
  ScmApplyChecksResult,
  ScmChangeRequestEventKind,
  ScmChangeRequestLinks,
  ScmCheck,
  ScmCiStatus,
  ScmProvider,
  ScmReviewDecision,
  ScmUpsertChangeRequestParams,
} from '@lobechat/types';
import { and, desc, eq, isNull } from 'drizzle-orm';

import type { ScmChangeRequestItem } from '../../schemas';
import { scmChangeRequests } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/** Conclusions that make the rollup a failure. Cancelled and skipped runs are neutral. */
const FAILING_CONCLUSIONS = new Set(['action_required', 'failure', 'startup_failure', 'timed_out']);

/**
 * Fold a set of checks into one CI status. Pending wins over everything
 * because the user cannot act on a partial result; failure wins over
 * success; an empty set is `unknown` rather than `success` so "no CI
 * configured" never reads as a green light.
 */
export const rollupCiStatus = (checks: ScmCheck[] | null | undefined): ScmCiStatus => {
  if (!checks || checks.length === 0) return 'unknown';

  let failed = false;
  for (const check of checks) {
    if (check.status !== 'completed') return 'pending';
    if (check.conclusion && FAILING_CONCLUSIONS.has(check.conclusion)) failed = true;
  }

  return failed ? 'failure' : 'success';
};

/** Whether one check's conclusion counts as a failure in the rollup. */
export const isFailingCheck = (check: ScmCheck): boolean =>
  check.status === 'completed' && !!check.conclusion && FAILING_CONCLUSIONS.has(check.conclusion);

/** Merge incoming checks into the stored set by external id; incoming wins. */
export const mergeChecks = (current: ScmCheck[] | null | undefined, incoming: ScmCheck[]) => {
  const byId = new Map<string, ScmCheck>();
  for (const check of current ?? []) byId.set(check.externalId, check);
  for (const check of incoming) byId.set(check.externalId, check);
  return [...byId.values()];
};

/**
 * CRUD for `scm_change_requests`, the hub row an inbound provider event
 * resolves to. Writers are server-side ingest paths, so the model is static
 * over the db; scope lives on the row.
 */
export class ScmChangeRequestModel {
  static findByIdentity = async (
    db: LobeChatDatabase,
    provider: ScmProvider,
    repoFullName: string,
    number: number,
  ): Promise<ScmChangeRequestItem | null> => {
    const [row] = await db
      .select()
      .from(scmChangeRequests)
      .where(
        and(
          eq(scmChangeRequests.provider, provider),
          eq(scmChangeRequests.repoFullName, repoFullName),
          eq(scmChangeRequests.number, number),
        ),
      )
      .limit(1);

    return row ?? null;
  };

  static findById = async (
    db: LobeChatDatabase,
    id: string,
  ): Promise<ScmChangeRequestItem | null> => {
    const [row] = await db.select().from(scmChangeRequests).where(eq(scmChangeRequests.id, id));
    return row ?? null;
  };

  /** Open change requests whose head is the given commit; `check_run` events name a sha, not a number. */
  static findByHeadSha = async (
    db: LobeChatDatabase,
    provider: ScmProvider,
    repoFullName: string,
    headSha: string,
  ): Promise<ScmChangeRequestItem[]> =>
    db
      .select()
      .from(scmChangeRequests)
      .where(
        and(
          eq(scmChangeRequests.provider, provider),
          eq(scmChangeRequests.repoFullName, repoFullName),
          eq(scmChangeRequests.headSha, headSha),
        ),
      );

  static listByAcceptance = async (
    db: LobeChatDatabase,
    acceptanceId: string,
  ): Promise<ScmChangeRequestItem[]> =>
    db
      .select()
      .from(scmChangeRequests)
      .where(eq(scmChangeRequests.acceptanceId, acceptanceId))
      .orderBy(desc(scmChangeRequests.updatedAt));

  /** Change requests visible to a scope, newest activity first. */
  static listByScope = async (
    db: LobeChatDatabase,
    scope: { userId: string; workspaceId?: string | null },
    options: { limit?: number } = {},
  ): Promise<ScmChangeRequestItem[]> => {
    const scopeCondition = scope.workspaceId
      ? eq(scmChangeRequests.workspaceId, scope.workspaceId)
      : and(eq(scmChangeRequests.userId, scope.userId), isNull(scmChangeRequests.workspaceId));

    return db
      .select()
      .from(scmChangeRequests)
      .where(scopeCondition)
      .orderBy(desc(scmChangeRequests.updatedAt))
      .limit(options.limit ?? 50);
  };

  static listByTopic = async (
    db: LobeChatDatabase,
    topicId: string,
  ): Promise<ScmChangeRequestItem[]> =>
    db
      .select()
      .from(scmChangeRequests)
      .where(eq(scmChangeRequests.topicId, topicId))
      .orderBy(desc(scmChangeRequests.updatedAt));

  /**
   * Create or refresh the hub row from a provider snapshot. A new head commit
   * resets the CI rollup: the stored checks described the old commit.
   * Links are only ever filled in, never cleared, so a later event that could
   * not resolve the acceptance does not drop a link an earlier one found —
   * unless the installation moved to another tenant since the row was
   * created, in which case the row follows it and the tenant-owned links
   * (acceptance, topic, task, Work) start over from what this event resolved.
   */
  static upsert = async (
    db: LobeChatDatabase,
    params: ScmUpsertChangeRequestParams,
  ): Promise<ScmChangeRequestItem> => {
    const existing = await ScmChangeRequestModel.findByIdentity(
      db,
      params.provider,
      params.repoFullName,
      params.number,
    );

    // Deliveries are not ordered: GitHub retries, and a redelivery of an old
    // `opened` after a `merged` would otherwise reopen the row, rewind the
    // head and drop the CI rollup for the commit that actually landed. Two
    // independent guards, because neither covers the other:
    //
    // - an event whose provider timestamp predates the newest one applied is
    //   a replay (compared provider-clock to provider-clock; the
    //   `lastEventAt` column also carries events we stamp ourselves, so it
    //   cannot serve as the reference);
    // - a merge is terminal and a close only reopens through `reopened`,
    //   whatever the timestamps say.
    const previousEventAt = existing?.metadata?.lastProviderEventAt;
    const outOfOrder =
      !!previousEventAt && !!params.eventAt && params.eventAt < new Date(previousEventAt);
    const regressesLifecycle =
      (existing?.state === 'merged' && params.state !== 'merged') ||
      (existing?.state === 'closed' && params.state === 'open' && params.eventKind !== 'reopened');
    const stale = !!existing && (outOfOrder || regressesLifecycle);

    const headChanged =
      !stale && !!params.headSha && !!existing && existing.headSha !== params.headSha;
    const links = params.links ?? {};
    const now = new Date();

    // Lifecycle stamps are state the provider can legitimately reset — a
    // reopened pull request reports `closed_at: null` — so for those an
    // explicit `null` clears the column and only `undefined` (the caller
    // said nothing) keeps it. Descriptive fields keep the lenient rule: a
    // payload that omits the title should not erase the stored one.
    const resettable = <T>(next: T | null | undefined, previous: T | null | undefined): T | null =>
      next === undefined ? (previous ?? null) : next;

    const snapshot = {
      authorExternalId: params.authorExternalId ?? existing?.authorExternalId ?? null,
      authorExternalLogin: params.authorExternalLogin ?? existing?.authorExternalLogin ?? null,
      baseRef: params.baseRef ?? existing?.baseRef ?? null,
      closedAt: resettable(params.closedAt, existing?.closedAt),
      externalId: params.externalId ?? existing?.externalId ?? null,
      headRef: params.headRef ?? existing?.headRef ?? null,
      headSha: params.headSha ?? existing?.headSha ?? null,
      isDraft: params.isDraft ?? existing?.isDraft ?? false,
      mergeStateStatus: params.mergeStateStatus ?? existing?.mergeStateStatus ?? null,
      mergedAt: resettable(params.mergedAt, existing?.mergedAt),
      mergedByExternalId: resettable(params.mergedByExternalId, existing?.mergedByExternalId),
      metadata: {
        ...existing?.metadata,
        ...params.metadata,
        ...(params.eventAt ? { lastProviderEventAt: params.eventAt.toISOString() } : {}),
      },
      repoExternalId: params.repoExternalId ?? existing?.repoExternalId ?? null,
      state: params.state,
      title: params.title ?? existing?.title ?? null,
      url: params.url,
    };

    const scopeMoved =
      !!existing &&
      (existing.userId !== params.userId ||
        (existing.workspaceId ?? null) !== (params.workspaceId ?? null));
    const inherited = scopeMoved ? undefined : existing;
    const linkValues = {
      acceptanceId: links.acceptanceId ?? inherited?.acceptanceId ?? null,
      installationId: links.installationId ?? existing?.installationId ?? null,
      taskId: links.taskId ?? inherited?.taskId ?? null,
      topicId: links.topicId ?? inherited?.topicId ?? null,
      workId: links.workId ?? inherited?.workId ?? null,
    };
    const ownerValues = scopeMoved
      ? { userId: params.userId, workspaceId: params.workspaceId ?? null }
      : {};

    const ciValues = headChanged
      ? { checks: null, ciHeadSha: params.headSha ?? null, ciStatus: null }
      : {};

    const eventValues =
      params.eventKind && !stale
        ? { lastEventAt: params.eventAt ?? now, lastEventKind: params.eventKind }
        : {};

    if (existing) {
      // A stale delivery still carries link context worth keeping (an
      // acceptance id parsed from the body), so fills apply; the lifecycle
      // columns do not.
      const stateValues = stale
        ? { metadata: { ...snapshot.metadata, ...existing.metadata, ...params.metadata } }
        : snapshot;
      const [row] = await db
        .update(scmChangeRequests)
        .set({
          ...stateValues,
          ...linkValues,
          ...ownerValues,
          ...ciValues,
          ...eventValues,
          updatedAt: now,
        })
        .where(eq(scmChangeRequests.id, existing.id))
        .returning();
      return row;
    }

    const [row] = await db
      .insert(scmChangeRequests)
      .values({
        ...snapshot,
        ...linkValues,
        ...eventValues,
        ciHeadSha: params.headSha ?? null,
        number: params.number,
        provider: params.provider,
        repoFullName: params.repoFullName,
        userId: params.userId,
        workspaceId: params.workspaceId ?? null,
      })
      .returning();

    return row;
  };

  /** Fill in links that are still null. Never overwrites a link already set. */
  static attachLinks = async (
    db: LobeChatDatabase,
    id: string,
    links: ScmChangeRequestLinks,
  ): Promise<ScmChangeRequestItem | null> => {
    const existing = await ScmChangeRequestModel.findById(db, id);
    if (!existing) return null;

    const set: Partial<ScmChangeRequestLinks> = {};
    for (const key of ['acceptanceId', 'installationId', 'taskId', 'topicId', 'workId'] as const) {
      if (!existing[key] && links[key]) set[key] = links[key];
    }
    if (Object.keys(set).length === 0) return existing;

    const [row] = await db
      .update(scmChangeRequests)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(scmChangeRequests.id, id))
      .returning();
    return row;
  };

  /**
   * Merge check results for a commit into the row and recompute the rollup.
   * Results for a commit other than the row's current head are stale (the
   * agent already pushed again) and are dropped without touching the row.
   */
  static applyChecks = async (
    db: LobeChatDatabase,
    id: string,
    params: ScmApplyChecksParams,
  ): Promise<ScmApplyChecksResult<ScmChangeRequestItem> | null> =>
    // Deliveries for the jobs of one commit arrive together and are handled
    // concurrently; each merges its own check into the stored set, so the
    // read and the write must not interleave or the last writer drops the
    // others' checks. The row lock serialises them.
    db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(scmChangeRequests)
        .where(eq(scmChangeRequests.id, id))
        .for('update');
      if (!existing) return null;

      if (existing.headSha && existing.headSha !== params.headSha) {
        return {
          applied: false,
          ciStatus: existing.ciStatus,
          previousCiStatus: existing.ciStatus,
          row: existing,
        };
      }

      const sameCommit = existing.ciHeadSha === params.headSha;
      const checks =
        params.replace || !sameCommit ? params.checks : mergeChecks(existing.checks, params.checks);
      const ciStatus = rollupCiStatus(checks);

      const [row] = await tx
        .update(scmChangeRequests)
        .set({ checks, ciHeadSha: params.headSha, ciStatus, updatedAt: new Date() })
        .where(eq(scmChangeRequests.id, id))
        .returning();

      return {
        applied: true,
        ciStatus,
        previousCiStatus: sameCommit ? existing.ciStatus : null,
        row,
      };
    });

  /**
   * Record one reviewer's verdict and recompute the change request's
   * rollup. GitHub reports reviews per reviewer, not as an aggregate, so
   * storing the newest event verbatim would let a later approval bury
   * another reviewer's outstanding changes request (and the reverse, on a
   * different delivery order). `decision: null` drops the reviewer, which
   * is what a dismissal means.
   */
  static applyReviewerDecision = async (
    db: LobeChatDatabase,
    id: string,
    params: {
      at?: Date;
      decision: 'approved' | 'changes_requested' | null;
      /** Provider user id; without one the verdict cannot be attributed. */
      reviewerId?: string | null;
    },
  ): Promise<ScmReviewDecision | null> =>
    db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(scmChangeRequests)
        .where(eq(scmChangeRequests.id, id))
        .for('update');
      if (!existing) return null;

      const reviewers = { ...existing.metadata?.reviewers };
      if (params.reviewerId) {
        if (params.decision) {
          reviewers[params.reviewerId] = {
            at: (params.at ?? new Date()).toISOString(),
            decision: params.decision,
          };
        } else delete reviewers[params.reviewerId];
      }

      const verdicts = Object.values(reviewers).map((entry) => entry.decision);
      const reviewDecision: ScmReviewDecision | null = verdicts.includes('changes_requested')
        ? 'changes_requested'
        : verdicts.includes('approved')
          ? 'approved'
          : null;

      await tx
        .update(scmChangeRequests)
        .set({
          metadata: { ...existing.metadata, reviewers },
          reviewDecision,
          updatedAt: new Date(),
        })
        .where(eq(scmChangeRequests.id, id));
      return reviewDecision;
    });

  static setReviewDecision = async (
    db: LobeChatDatabase,
    id: string,
    reviewDecision: ScmReviewDecision | null,
  ): Promise<void> => {
    await db
      .update(scmChangeRequests)
      .set({ reviewDecision, updatedAt: new Date() })
      .where(eq(scmChangeRequests.id, id));
  };

  static recordEvent = async (
    db: LobeChatDatabase,
    id: string,
    kind: ScmChangeRequestEventKind,
    at: Date = new Date(),
  ): Promise<void> => {
    await db
      .update(scmChangeRequests)
      .set({ lastEventAt: at, lastEventKind: kind, updatedAt: new Date() })
      .where(eq(scmChangeRequests.id, id));
  };

  /** Bump the wake counter; returns the new count so the caller can enforce its cap. */
  static recordWake = async (db: LobeChatDatabase, id: string): Promise<number> => {
    const existing = await ScmChangeRequestModel.findById(db, id);
    if (!existing) return 0;

    const wakeCount = existing.wakeCount + 1;
    await db
      .update(scmChangeRequests)
      .set({ lastWakeAt: new Date(), updatedAt: new Date(), wakeCount })
      .where(eq(scmChangeRequests.id, id));
    return wakeCount;
  };
}

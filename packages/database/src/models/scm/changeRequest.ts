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
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import type { ScmChangeRequestItem } from '../../schemas';
import { scmChangeRequests, scmInstallations } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/**
 * Conclusions worth waking an agent over: something broke and there is
 * something to fix. A cancelled or stale run is not one of them — usually a
 * human superseded it — but it is not a pass either, which is why the two
 * sets below are separate rather than complements.
 */
const FAILING_CONCLUSIONS = new Set(['action_required', 'failure', 'startup_failure', 'timed_out']);

/** The only conclusions that let the rollup read as green. */
const GREEN_CONCLUSIONS = new Set(['neutral', 'skipped', 'success']);

/**
 * Fold a set of checks into one CI status. Pending wins over everything
 * because the user cannot act on a partial result, then failure, then
 * `unknown` — a commit whose workflow was cancelled has not passed, and
 * saying `success` there would hand a green light to merge automation. An
 * empty set is `unknown` too, so "no CI configured" never reads as green.
 */
export const rollupCiStatus = (checks: ScmCheck[] | null | undefined): ScmCiStatus => {
  if (!checks || checks.length === 0) return 'unknown';

  let failed = false;
  let inconclusive = false;
  for (const check of checks) {
    if (check.status !== 'completed') return 'pending';
    if (check.conclusion && FAILING_CONCLUSIONS.has(check.conclusion)) failed = true;
    else if (!check.conclusion || !GREEN_CONCLUSIONS.has(check.conclusion)) inconclusive = true;
  }

  if (failed) return 'failure';
  return inconclusive ? 'unknown' : 'success';
};

/** Whether one check's conclusion counts as a failure in the rollup. */
export const isFailingCheck = (check: ScmCheck): boolean =>
  check.status === 'completed' && !!check.conclusion && FAILING_CONCLUSIONS.has(check.conclusion);

/** Merge incoming checks into the stored set by external id; incoming wins. */
/**
 * When this result was reported, as the provider timed it. A completed run
 * always sorts after a pending one for the same id, so a delayed "queued"
 * cannot un-finish a check even when neither side carries a timestamp.
 */
const reportedAt = (check: ScmCheck): number => {
  const stamp = check.reportedAt ?? check.completedAt ?? check.startedAt;
  const parsed = stamp ? Date.parse(stamp) : Number.NaN;
  if (!Number.isNaN(parsed)) return parsed;
  return check.status === 'completed' ? 1 : 0;
};

/**
 * What the check *is*, as opposed to which attempt reported it. Re-running a
 * failed Actions job mints a new `check_run:<id>`, so keying the set by the
 * external id alone keeps the failed attempt next to its successful
 * replacement and pins the rollup to `failure` forever.
 *
 * GitHub's own answer to "which result counts" is the latest run of a given
 * name *published by a given app* (`GET /commits/{ref}/check-runs?filter=latest`),
 * so that is the identity used here. Dropping the app would let one app's
 * passing `Test` erase another's failing `Test`; dropping the name would
 * stop reruns from superseding anything. The legacy status API has no app
 * and its context is unique per commit, so its namespace carries the name
 * alone.
 */
const checkIdentity = (check: ScmCheck): string => {
  const [namespace] = check.externalId.split(':');
  const name = check.name?.trim();
  if (!name) return check.externalId;
  return check.appId ? `${namespace}:app:${check.appId}:${name}` : `${namespace}:${name}`;
};

export const mergeChecks = (current: ScmCheck[] | null | undefined, incoming: ScmCheck[]) => {
  const byIdentity = new Map<string, ScmCheck>();
  for (const check of current ?? []) byIdentity.set(checkIdentity(check), check);
  for (const check of incoming) {
    const key = checkIdentity(check);
    const stored = byIdentity.get(key);
    // A delayed pending event must not regress a completed check, and a
    // delayed success must not hide a newer failure.
    if (stored && reportedAt(stored) > reportedAt(check)) continue;
    byIdentity.set(key, check);
  }
  return [...byIdentity.values()];
};

/**
 * CRUD for `scm_change_requests`, the hub row an inbound provider event
 * resolves to. Writers are server-side ingest paths, so the model is static
 * over the db; scope lives on the row.
 */
export class ScmChangeRequestModel {
  /**
   * The change request by the provider's own id for it (GitHub's PR node
   * id). Stable across a repository rename or transfer, which is what the
   * name-based key is not.
   */
  static findByExternalId = async (
    db: LobeChatDatabase,
    provider: ScmProvider,
    externalId: string,
  ): Promise<ScmChangeRequestItem | null> => {
    const [row] = await db
      .select()
      .from(scmChangeRequests)
      .where(
        and(eq(scmChangeRequests.provider, provider), eq(scmChangeRequests.externalId, externalId)),
      )
      .limit(1);

    return row ?? null;
  };

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
  /**
   * What this scope should see: its own change requests, plus everything on
   * the installations it connected.
   *
   * The two are no longer the same set. A row belongs to whoever opened the
   * pull request, which may be a member using their personal agent, while
   * the installation belongs to the workspace — without the second half a
   * workspace would stop seeing pull requests on its own repositories.
   */
  static listByScope = async (
    db: LobeChatDatabase,
    scope: { userId: string; workspaceId?: string | null },
    options: { limit?: number } = {},
  ): Promise<ScmChangeRequestItem[]> => {
    const owned = scope.workspaceId
      ? eq(scmChangeRequests.workspaceId, scope.workspaceId)
      : and(eq(scmChangeRequests.userId, scope.userId), isNull(scmChangeRequests.workspaceId));

    const connected = db
      .select({ id: scmInstallations.id })
      .from(scmInstallations)
      .where(
        and(
          isNull(scmInstallations.revokedAt),
          scope.workspaceId
            ? eq(scmInstallations.workspaceId, scope.workspaceId)
            : and(eq(scmInstallations.userId, scope.userId), isNull(scmInstallations.workspaceId)),
        ),
      );

    return db
      .select()
      .from(scmChangeRequests)
      .where(or(owned, inArray(scmChangeRequests.installationId, connected)))
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
  ): Promise<ScmChangeRequestItem> =>
    // The whole read-modify-write runs under a row lock. Reading the row
    // outside one lets a `merged` and an older `synchronize` delivery both
    // see the pre-merge state, and whichever writes last wins — the stale
    // guards below can only judge what they were shown.
    db.transaction(async (tx) => {
      // Renaming or transferring a repository changes `repoFullName` on
      // every later delivery, so the name-based key would miss the row and
      // insert a second one — splitting the checks, the review state and
      // the acceptance links off the copy still on screen. The provider's
      // own id for the pull request survives both, so it leads.
      const [existing] = await tx
        .select()
        .from(scmChangeRequests)
        .where(
          and(
            eq(scmChangeRequests.provider, params.provider),
            params.externalId
              ? eq(scmChangeRequests.externalId, params.externalId)
              : and(
                  eq(scmChangeRequests.repoFullName, params.repoFullName),
                  eq(scmChangeRequests.number, params.number),
                )!,
          ),
        )
        .for('update');

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
        (existing?.state === 'closed' &&
          params.state === 'open' &&
          params.eventKind !== 'reopened');
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
      const resettable = <T>(
        next: T | null | undefined,
        previous: T | null | undefined,
      ): T | null => (next === undefined ? (previous ?? null) : next);

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
          ...(params.keepOwner && existing ? { routedBy: existing.metadata?.routedBy } : {}),
          ...(params.eventAt ? { lastProviderEventAt: params.eventAt.toISOString() } : {}),
          // Once adopted (or superseded by a newer head) the bucket is spent.
          ...(headChanged ? { pendingChecks: undefined } : {}),
        },
        repoExternalId: params.repoExternalId ?? existing?.repoExternalId ?? null,
        // Follow a rename rather than leaving the row under the old name.
        repoFullName: params.repoFullName,
        state: params.state,
        title: params.title ?? existing?.title ?? null,
        url: params.url,
      };

      const scopeMoved =
        !!existing &&
        !params.keepOwner &&
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
        ? (() => {
            // Results reported before this push became the head belong to
            // the new commit, not to the one being replaced.
            const held = existing?.metadata?.pendingChecks;
            const adopted = held && held.sha === params.headSha ? held.checks : null;
            return {
              checks: adopted,
              ciHeadSha: params.headSha ?? null,
              ciStatus: adopted ? rollupCiStatus(adopted) : null,
            };
          })()
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
        const [row] = await tx
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

      // No row to lock yet, so two first deliveries can race here; the
      // unique index settles it and both end up applied.
      const [row] = await tx
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
        .onConflictDoUpdate({
          set: { ...snapshot, ...linkValues, ...eventValues, updatedAt: now },
          target: [
            scmChangeRequests.provider,
            scmChangeRequests.repoFullName,
            scmChangeRequests.number,
          ],
        })
        .returning();

      return row;
    });

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
        // Not necessarily stale: GitHub can report a job for a commit before
        // the `synchronize` that makes it the head. Hold the results against
        // that commit — `upsert` adopts them when the head catches up, and a
        // newer commit simply replaces the bucket.
        const held = existing.metadata?.pendingChecks;
        const pendingChecks = {
          checks:
            held?.sha === params.headSha ? mergeChecks(held.checks, params.checks) : params.checks,
          sha: params.headSha,
        };
        const [row] = await tx
          .update(scmChangeRequests)
          .set({ metadata: { ...existing.metadata, pendingChecks }, updatedAt: new Date() })
          .where(eq(scmChangeRequests.id, id))
          .returning();

        return {
          applied: false,
          ciStatus: existing.ciStatus,
          previousCiStatus: existing.ciStatus,
          row,
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
  ): Promise<{ applied: boolean; reviewDecision: ScmReviewDecision | null }> =>
    db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(scmChangeRequests)
        .where(eq(scmChangeRequests.id, id))
        .for('update');
      if (!existing) return { applied: false, reviewDecision: null };

      const reviewers = { ...existing.metadata?.reviewers };
      let stale = false;
      if (params.reviewerId) {
        // Reviews are delivered per reviewer and can arrive out of order; an
        // approval submitted after a changes-request must not be undone by
        // the older event landing second.
        const stored = reviewers[params.reviewerId];
        const at = params.at ?? new Date();
        const storedAt = stored?.at ? Date.parse(stored.at) : Number.NaN;
        stale = !Number.isNaN(storedAt) && at.getTime() < storedAt;

        if (stale) {
          // nothing to apply: the stored verdict is the newer one
        } else if (params.decision) {
          reviewers[params.reviewerId] = { at: at.toISOString(), decision: params.decision };
        } else delete reviewers[params.reviewerId];
      }

      const verdicts = Object.values(reviewers).map((entry) => entry.decision);
      const reviewDecision: ScmReviewDecision | null = verdicts.includes('changes_requested')
        ? 'changes_requested'
        : verdicts.includes('approved')
          ? 'approved'
          : null;

      if (stale) return { applied: false, reviewDecision: existing.reviewDecision };

      await tx
        .update(scmChangeRequests)
        .set({
          metadata: { ...existing.metadata, reviewers },
          reviewDecision,
          updatedAt: new Date(),
        })
        .where(eq(scmChangeRequests.id, id));
      return { applied: true, reviewDecision };
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

  /**
   * Note a wake the debounce window swallowed, for the next delivery to
   * carry. Touches only its own key: deliveries for one change request are
   * handled concurrently, so writing the whole metadata column back would
   * let a read-modify-write erase whatever another handler stored in
   * between — the tracking comment id, the last wake, held checks.
   */
  static markPendingWake = async (
    db: LobeChatDatabase,
    id: string,
    reason: string,
  ): Promise<void> => {
    await db
      .update(scmChangeRequests)
      .set({
        metadata: sql`${scmChangeRequests.metadata} || ${JSON.stringify({
          pendingWake: { reason, since: new Date().toISOString() },
        })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scmChangeRequests.id, id),
          // First reason of the burst wins, as before.
          sql`not coalesce(jsonb_exists(${scmChangeRequests.metadata}, 'pendingWake'), false)`,
        ),
      );
  };

  static clearPendingWake = async (db: LobeChatDatabase, id: string): Promise<void> => {
    await db
      .update(scmChangeRequests)
      .set({
        metadata: sql`${scmChangeRequests.metadata} - 'pendingWake'`,
        updatedAt: new Date(),
      })
      .where(eq(scmChangeRequests.id, id));
  };

  /**
   * Claim one of the `max` wakes this change request is allowed, atomically.
   *
   * The cap has to be enforced by the database, not by the caller: without
   * Redis there is no debounce, so two webhooks landing together both read
   * the same `wakeCount` and a read-modify-write would lose one increment.
   * A conditional `UPDATE … WHERE wake_count < max` lets exactly one of them
   * through per remaining slot. Returns the new count, or `null` when the
   * cap is already spent.
   */
  static reserveWake = async (
    db: LobeChatDatabase,
    id: string,
    max: number,
    reason?: string,
  ): Promise<number | null> => {
    const now = new Date();
    // jsonb concat rather than a read-modify-write: it merges the one key
    // this update owns and leaves every other key as the row has it.
    const metadata = reason
      ? sql`${scmChangeRequests.metadata} || ${JSON.stringify({
          lastWake: { at: now.toISOString(), reason },
        })}::jsonb`
      : undefined;

    const [reserved] = await db
      .update(scmChangeRequests)
      .set({
        lastWakeAt: now,
        ...(metadata ? { metadata } : {}),
        updatedAt: now,
        wakeCount: sql`${scmChangeRequests.wakeCount} + 1`,
      })
      .where(and(eq(scmChangeRequests.id, id), lt(scmChangeRequests.wakeCount, max)))
      .returning({ wakeCount: scmChangeRequests.wakeCount });

    return reserved?.wakeCount ?? null;
  };

  /**
   * Take the right to post the tracking comment, atomically.
   *
   * Posting a comment is irreversible, so the single-writer decision cannot
   * live in the application: `opened` and the `synchronize` a second later
   * are handled concurrently, and on a deployment without Redis nothing
   * else stops them both from seeing an unposted row. A conditional update
   * on the metadata bag lets exactly one through; the claim goes stale
   * after `staleAfterMs` so a crashed post does not block the row forever.
   */
  static claimCommentSlot = async (
    db: LobeChatDatabase,
    id: string,
    staleAfterMs = 5 * 60 * 1000,
  ): Promise<boolean> => {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - staleAfterMs).toISOString();

    const [claimed] = await db
      .update(scmChangeRequests)
      .set({
        metadata: sql`${scmChangeRequests.metadata} || ${JSON.stringify({
          commentClaimedAt: now.toISOString(),
        })}::jsonb`,
        updatedAt: now,
      })
      .where(
        and(
          eq(scmChangeRequests.id, id),
          // Key existence, not `->> … IS NULL`: an IS NULL on an extracted
          // jsonb value takes the planner down on any bm25-indexed table.
          sql`coalesce(${scmChangeRequests.metadata} ->> 'lobehubCommentId', '') = ''`,
          sql`coalesce(${scmChangeRequests.metadata} ->> 'commentClaimedAt', '') < ${staleBefore}`,
        ),
      )
      .returning({ id: scmChangeRequests.id });

    return Boolean(claimed);
  };

  /** Give the comment slot back when the post never happened. */
  static releaseCommentSlot = async (db: LobeChatDatabase, id: string): Promise<void> => {
    await db
      .update(scmChangeRequests)
      .set({
        metadata: sql`${scmChangeRequests.metadata} - 'commentClaimedAt'`,
        updatedAt: new Date(),
      })
      .where(eq(scmChangeRequests.id, id));
  };

  /** Hand a reserved wake back when the run never started. */
  static releaseWake = async (db: LobeChatDatabase, id: string): Promise<void> => {
    await db
      .update(scmChangeRequests)
      .set({
        updatedAt: new Date(),
        wakeCount: sql`greatest(${scmChangeRequests.wakeCount} - 1, 0)`,
      })
      .where(eq(scmChangeRequests.id, id));
  };
}

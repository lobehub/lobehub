import type {
  ScmChangeRequestEventKind,
  ScmChangeRequestMetadata,
  ScmChangeRequestState,
  ScmCheck,
  ScmCiStatus,
  ScmProvider,
  ScmReviewDecision,
} from '@lobechat/types';
import { and, desc, eq, isNull } from 'drizzle-orm';

import type { ScmChangeRequestItem } from '../../schemas';
import { scmChangeRequests } from '../../schemas';
import type { LobeChatDatabase } from '../../type';

/** Provider facts about a change request, as normalized from a webhook payload or API read. */
export interface ScmChangeRequestSnapshot {
  authorExternalId?: string | null;
  authorExternalLogin?: string | null;
  baseRef?: string | null;
  closedAt?: Date | null;
  externalId?: string | null;
  headRef?: string | null;
  headSha?: string | null;
  isDraft?: boolean;
  mergedAt?: Date | null;
  mergedByExternalId?: string | null;
  mergeStateStatus?: string | null;
  metadata?: ScmChangeRequestMetadata;
  number: number;
  provider: ScmProvider;
  repoExternalId?: string | null;
  repoFullName: string;
  state: ScmChangeRequestState;
  title?: string | null;
  url: string;
}

export interface ScmChangeRequestLinks {
  acceptanceId?: string | null;
  installationId?: string | null;
  taskId?: string | null;
  topicId?: string | null;
  workId?: string | null;
}

export interface UpsertScmChangeRequestParams extends ScmChangeRequestSnapshot {
  eventAt?: Date;
  eventKind?: ScmChangeRequestEventKind;
  links?: ScmChangeRequestLinks;
  userId: string;
  workspaceId?: string | null;
}

export interface ApplyChecksParams {
  checks: ScmCheck[];
  /** Commit the checks describe; a mismatch with the row's head is dropped as stale. */
  headSha: string;
  /** When true, `checks` replaces the stored set instead of merging by id. */
  replace?: boolean;
}

export interface ApplyChecksResult {
  applied: boolean;
  ciStatus: ScmCiStatus | null;
  previousCiStatus: ScmCiStatus | null;
  row: ScmChangeRequestItem;
}

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
   * not resolve the acceptance does not drop a link an earlier one found.
   */
  static upsert = async (
    db: LobeChatDatabase,
    params: UpsertScmChangeRequestParams,
  ): Promise<ScmChangeRequestItem> => {
    const existing = await ScmChangeRequestModel.findByIdentity(
      db,
      params.provider,
      params.repoFullName,
      params.number,
    );

    const headChanged = !!params.headSha && !!existing && existing.headSha !== params.headSha;
    const links = params.links ?? {};
    const now = new Date();

    const snapshot = {
      authorExternalId: params.authorExternalId ?? existing?.authorExternalId ?? null,
      authorExternalLogin: params.authorExternalLogin ?? existing?.authorExternalLogin ?? null,
      baseRef: params.baseRef ?? existing?.baseRef ?? null,
      closedAt: params.closedAt ?? existing?.closedAt ?? null,
      externalId: params.externalId ?? existing?.externalId ?? null,
      headRef: params.headRef ?? existing?.headRef ?? null,
      headSha: params.headSha ?? existing?.headSha ?? null,
      isDraft: params.isDraft ?? existing?.isDraft ?? false,
      mergeStateStatus: params.mergeStateStatus ?? existing?.mergeStateStatus ?? null,
      mergedAt: params.mergedAt ?? existing?.mergedAt ?? null,
      mergedByExternalId: params.mergedByExternalId ?? existing?.mergedByExternalId ?? null,
      metadata: { ...existing?.metadata, ...params.metadata },
      repoExternalId: params.repoExternalId ?? existing?.repoExternalId ?? null,
      state: params.state,
      title: params.title ?? existing?.title ?? null,
      url: params.url,
    };

    const linkValues = {
      acceptanceId: links.acceptanceId ?? existing?.acceptanceId ?? null,
      installationId: links.installationId ?? existing?.installationId ?? null,
      taskId: links.taskId ?? existing?.taskId ?? null,
      topicId: links.topicId ?? existing?.topicId ?? null,
      workId: links.workId ?? existing?.workId ?? null,
    };

    const ciValues = headChanged
      ? { checks: null, ciHeadSha: params.headSha ?? null, ciStatus: null }
      : {};

    const eventValues = params.eventKind
      ? { lastEventAt: params.eventAt ?? now, lastEventKind: params.eventKind }
      : {};

    if (existing) {
      const [row] = await db
        .update(scmChangeRequests)
        .set({ ...snapshot, ...linkValues, ...ciValues, ...eventValues, updatedAt: now })
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
    params: ApplyChecksParams,
  ): Promise<ApplyChecksResult | null> => {
    const existing = await ScmChangeRequestModel.findById(db, id);
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

    const [row] = await db
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
  };

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

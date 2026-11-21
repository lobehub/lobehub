import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import {
  type AgentInterventionItem,
  agentInterventionResolutions,
  agentInterventions,
} from '../../schemas';
import type { Transaction } from '../../type';
import { HASH_PATTERN, UUID_PATTERN } from './constants';
import {
  type AgentInterventionContext,
  ownerOnly,
  ownership,
  publicResolutionColumns,
  reload,
  reloadBatch,
  resolutionOwnership,
} from './context';
import type { AgentInterventionBatchState } from './types';
import { uniqueSorted } from './utils';

export const findById = async (
  ctx: AgentInterventionContext,
  id: string,
): Promise<AgentInterventionItem | undefined> => {
  if (!UUID_PATTERN.test(id)) return undefined;
  const row = await reload(ctx, id);
  return row && withLazyTimeout(ctx, row);
};

/** Owner-only cold-start lookup used before restoring a workspace header. */
export const findByIdForOwner = async (
  ctx: AgentInterventionContext,
  id: string,
): Promise<AgentInterventionItem | undefined> => {
  if (!UUID_PATTERN.test(id)) return undefined;
  const [row] = await ctx.db
    .select()
    .from(agentInterventions)
    .where(and(eq(agentInterventions.id, id), ownerOnly(ctx)))
    .limit(1);
  return row && withOwnerLazyTimeout(ctx, row);
};

/** Legacy owner-auth token lookup. Workspace collaborators use the system locator + ACL. */
export const findByReviewTokenHash = async (
  ctx: AgentInterventionContext,
  reviewTokenHash: string,
): Promise<AgentInterventionItem | undefined> => {
  if (!HASH_PATTERN.test(reviewTokenHash)) return undefined;
  const [row] = await ctx.db
    .select()
    .from(agentInterventions)
    .where(and(eq(agentInterventions.reviewTokenHash, reviewTokenHash), ownerOnly(ctx)))
    .limit(1);
  return row && withOwnerLazyTimeout(ctx, row);
};

export const findBatch = async (
  ctx: AgentInterventionContext,
  operationId: string,
  batchId: string,
): Promise<AgentInterventionBatchState> => {
  const rows = await reloadBatch(ctx, operationId, batchId);
  if (rows.length === 0) return { interventions: [], resolutions: [] };
  if (
    rows.some(
      (row) =>
        ['pending', 'resolving', 'published'].includes(row.status) &&
        row.deadline.getTime() <= Date.now(),
    )
  ) {
    await markBatchTerminal(ctx, operationId, batchId, 'timed_out');
  }
  const interventions = await reloadBatch(ctx, operationId, batchId);
  const resolutionIds = uniqueSorted(
    interventions.flatMap((row) => (row.resolutionId ? [row.resolutionId] : [])),
  );
  const resolutions =
    resolutionIds.length === 0
      ? []
      : await ctx.db
          .select(publicResolutionColumns)
          .from(agentInterventionResolutions)
          .where(
            and(inArray(agentInterventionResolutions.id, resolutionIds), resolutionOwnership(ctx)),
          );
  return { interventions, resolutions };
};

/** Timeout/session teardown of every still-open item in one sealed batch. */
export const markBatchTerminal = async (
  ctx: AgentInterventionContext,
  operationId: string,
  batchId: string,
  status: 'session_ended' | 'timed_out',
  at = new Date(),
): Promise<AgentInterventionItem[]> =>
  ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(agentInterventions)
      .where(
        and(
          eq(agentInterventions.operationId, operationId),
          eq(agentInterventions.batchId, batchId),
          ownership(ctx),
        ),
      )
      .for('update');
    if (rows.length === 0) return [];
    if (status === 'timed_out' && rows.every((row) => row.deadline.getTime() > at.getTime())) {
      return rows;
    }

    const openRows = rows.filter((row) =>
      ['pending', 'resolving', 'published'].includes(row.status),
    );
    if (openRows.length === 0) return rows;
    return markRowsTerminalInTransaction(ctx, tx, rows, status, at);
  });

export const markRowsTerminalInTransaction = async (
  ctx: AgentInterventionContext,
  tx: Transaction,
  rows: AgentInterventionItem[],
  status: 'session_ended' | 'timed_out',
  at: Date,
): Promise<AgentInterventionItem[]> => {
  const openRows = rows.filter((row) => ['pending', 'resolving', 'published'].includes(row.status));
  if (openRows.length === 0) return rows;
  const resolutionIds = uniqueSorted(
    openRows.flatMap((row) => (row.resolutionId ? [row.resolutionId] : [])),
  );
  const protectedResolutionIds = new Set<string>();
  if (resolutionIds.length > 0) {
    const resolutions = await tx
      .select({
        customExecutionState: agentInterventionResolutions.customExecutionState,
        id: agentInterventionResolutions.id,
      })
      .from(agentInterventionResolutions)
      .where(and(inArray(agentInterventionResolutions.id, resolutionIds), resolutionOwnership(ctx)))
      .orderBy(asc(agentInterventionResolutions.id))
      .for('update');
    for (const resolution of resolutions) {
      if (['executing', 'completed'].includes(resolution.customExecutionState ?? '')) {
        protectedResolutionIds.add(resolution.id);
      }
    }
    const terminalResolutionIds = resolutionIds.filter(
      (resolutionId) => !protectedResolutionIds.has(resolutionId),
    );
    if (terminalResolutionIds.length > 0) {
      await tx
        .update(agentInterventionResolutions)
        .set({
          status,
          terminalAt: at,
          updatedAt: at,
          version: sql`${agentInterventionResolutions.version} + 1`,
        })
        .where(
          and(
            inArray(agentInterventionResolutions.id, terminalResolutionIds),
            inArray(agentInterventionResolutions.status, ['resolving', 'published']),
          ),
        );
    }
  }
  const terminalRows = openRows.filter(
    (row) => !row.resolutionId || !protectedResolutionIds.has(row.resolutionId),
  );
  if (terminalRows.length === 0) return rows;
  const updated = await tx
    .update(agentInterventions)
    .set({
      resolvedAt: at,
      status,
      updatedAt: at,
      version: sql`${agentInterventions.version} + 1`,
    })
    .where(
      inArray(
        agentInterventions.id,
        terminalRows.map((row) => row.id),
      ),
    )
    .returning();
  return rows.map((row) => updated.find((item) => item.id === row.id) ?? row);
};

export const withLazyTimeout = async (
  ctx: AgentInterventionContext,
  row: AgentInterventionItem,
  now = new Date(),
): Promise<AgentInterventionItem> => {
  if (
    !['pending', 'resolving', 'published'].includes(row.status) ||
    row.deadline.getTime() > now.getTime()
  ) {
    return row;
  }
  await markBatchTerminal(ctx, row.operationId, row.batchId, 'timed_out', now);
  return (await reload(ctx, row.id)) ?? row;
};

/** Owner-only cold lookup can recover the row's workspace before expiring its batch. */
export const withOwnerLazyTimeout = async (
  ctx: AgentInterventionContext,
  row: AgentInterventionItem,
  now = new Date(),
): Promise<AgentInterventionItem> => {
  if (
    !['pending', 'resolving', 'published'].includes(row.status) ||
    row.deadline.getTime() > now.getTime()
  ) {
    return row;
  }
  const scopedCtx = { db: ctx.db, userId: ctx.userId, workspaceId: row.workspaceId ?? undefined };
  await markBatchTerminal(scopedCtx, row.operationId, row.batchId, 'timed_out', now);
  const [updated] = await ctx.db
    .select()
    .from(agentInterventions)
    .where(and(eq(agentInterventions.id, row.id), ownerOnly(ctx)))
    .limit(1);
  return updated ?? row;
};

import type {
  CollectionWorkVersionMetadata,
  SharedAgentDeliveryStats,
  SharedAgentWork,
  WorkVersionMetadata,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import {
  and,
  type AnyColumn,
  avg,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  max,
  ne,
  notExists,
  or,
  sql,
  sum,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { agentOperations, agents, documents, tasks, topics, works, workVersions } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { getTotalCostByWorkIds } from './work/cost';
import { sanitizeExternalUrl } from './work/toolResultParsing';

const originTopics = alias(topics, 'share_work_origin_topics');
const currentTopics = alias(topics, 'share_work_current_topics');
const historyVersions = alias(workVersions, 'share_work_history_versions');
const historyTopics = alias(topics, 'share_work_history_topics');

/**
 * A profile row belongs to the shared agent's own scope: personal rows for a
 * personal agent, rows of the agent's Workspace for a Workspace agent. The
 * agent row is the single source of that scope, so a Work or run left in the
 * other scope (or an agent moved after the fact) never counts. Callers must
 * join `agents` on the shared agent id; subqueries reference it as an outer
 * column.
 */
const inAgentScope = (workspaceId: AnyColumn) =>
  sql`${workspaceId} is not distinct from ${agents.workspaceId}`;
const outsideAgentScope = (workspaceId: AnyColumn) =>
  sql`${workspaceId} is distinct from ${agents.workspaceId}`;

/**
 * The images of a collection Work, the only file links a share profile exposes:
 * featuring a collection is choosing to show its images. Each keeps only an
 * http(s) URL.
 */
const toSharedCollection = (
  metadata: WorkVersionMetadata | null,
): CollectionWorkVersionMetadata | undefined => {
  const collection = metadata?.collection;
  if (!collection) return undefined;
  const items = collection.items.flatMap(({ caption, fileId, mimeType, url }) => {
    const safeUrl = sanitizeExternalUrl(url);
    if (!safeUrl) return [];
    return [
      { ...(caption ? { caption } : {}), fileId, ...(mimeType ? { mimeType } : {}), url: safeUrl },
    ];
  });
  return { ...(collection.coverFileId ? { coverFileId: collection.coverFileId } : {}), items };
};

/** Owner-scoped source for explicitly curated share profiles, not a general resource grant. */
export class AgentShareProfileModel {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
  ) {}

  /**
   * Visitor runs use the creator's userId too. Require surviving creator-topic
   * provenance at both ends; a deleted topic must never turn a visitor Work
   * into an eligible creator Work through ON DELETE SET NULL.
   */
  private eligibleWorks = (agentId: string, ids?: string[]) =>
    this.db
      .select({
        createdAt: works.createdAt,
        deliveredAt: sql<Date>`${workVersions.createdAt}`
          .mapWith(workVersions.createdAt)
          .as('delivered_at'),
        description: works.description,
        id: works.id,
        identifier: works.identifier,
        resourceType: works.resourceType,
        status: works.status,
        title: works.title,
        type: works.type,
        updatedAt: works.updatedAt,
        url: works.url,
        versionMetadata: workVersions.metadata,
      })
      .from(works)
      .innerJoin(agents, eq(agents.id, works.originAgentId))
      .innerJoin(originTopics, eq(originTopics.id, works.originTopicId))
      .innerJoin(
        workVersions,
        and(eq(workVersions.id, works.currentVersionId), eq(workVersions.workId, works.id)),
      )
      .innerJoin(currentTopics, eq(currentTopics.id, workVersions.topicId))
      .where(
        and(
          eq(works.userId, this.userId),
          eq(works.originAgentId, agentId),
          eq(agents.userId, this.userId),
          sql`${agents.isDeleted} is not true`,
          inAgentScope(works.workspaceId),
          isNull(works.deletedAt),
          sql`${works.isDeleted} is not true`,
          eq(originTopics.userId, this.userId),
          inAgentScope(originTopics.workspaceId),
          isNull(originTopics.senderId),
          isNull(originTopics.deletedAt),
          sql`${originTopics.isDeleted} is not true`,
          eq(currentTopics.userId, this.userId),
          inAgentScope(currentTopics.workspaceId),
          isNull(currentTopics.senderId),
          isNull(currentTopics.deletedAt),
          sql`${currentTopics.isDeleted} is not true`,
          /** Later creator edits can inherit text from a visitor version; reject mixed provenance. */
          notExists(
            this.db
              .select({ id: historyVersions.id })
              .from(historyVersions)
              .leftJoin(historyTopics, eq(historyTopics.id, historyVersions.topicId))
              .where(
                and(
                  eq(historyVersions.workId, works.id),
                  or(
                    isNull(historyTopics.id),
                    isNotNull(historyTopics.senderId),
                    ne(historyTopics.userId, this.userId),
                    outsideAgentScope(historyTopics.workspaceId),
                  ),
                ),
              ),
          ),
          ids ? inArray(works.id, ids) : undefined,
          or(
            inArray(works.type, ['external', 'file', 'collection']),
            and(
              eq(works.type, 'document'),
              exists(
                this.db
                  .select({ id: documents.id })
                  .from(documents)
                  .where(
                    and(
                      eq(documents.id, works.resourceId),
                      eq(documents.userId, this.userId),
                      inAgentScope(documents.workspaceId),
                      isNull(documents.deletedAt),
                      sql`${documents.isDeleted} is not true`,
                    ),
                  ),
              ),
            ),
            and(
              eq(works.type, 'task'),
              exists(
                this.db
                  .select({ id: tasks.id })
                  .from(tasks)
                  .where(
                    and(
                      eq(tasks.id, works.resourceId),
                      eq(tasks.createdByUserId, this.userId),
                      inAgentScope(tasks.workspaceId),
                      isNull(tasks.deletedAt),
                      sql`${tasks.isDeleted} is not true`,
                    ),
                  ),
              ),
            ),
          ),
        ),
      );

  validateFeaturedWorks = async (agentId: string, workIds: string[]) => {
    if (workIds.length === 0) return;
    const rows = await this.eligibleWorks(agentId, workIds);
    if (new Set(workIds).size !== workIds.length || rows.length !== workIds.length) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only available creator Works from this agent can be featured',
      });
    }
  };

  listFeaturedWorks = async (agentId: string, workIds: string[]): Promise<SharedAgentWork[]> => {
    if (workIds.length === 0) return [];
    const rows = await this.eligibleWorks(agentId, workIds);
    const costs = await getTotalCostByWorkIds(
      { db: this.db, userId: this.userId },
      rows.map(({ id }) => id),
    );
    const byId = new Map(
      rows.map(({ deliveredAt: _deliveredAt, versionMetadata, ...work }) => {
        const collection =
          work.type === 'collection' ? toSharedCollection(versionMetadata) : undefined;
        return [
          work.id,
          {
            ...work,
            ...(collection ? { collection } : {}),
            totalCost: costs.get(work.id) ?? null,
            /**
             * File URLs can be bearer download links; featuring a file Work is not a
             * download grant. A collection's URL is its cover, shown with its images.
             */
            url:
              work.type === 'external' || work.type === 'collection'
                ? (sanitizeExternalUrl(work.url) ?? null)
                : null,
          },
        ];
      }),
    );
    return workIds.flatMap((id) => {
      const work = byId.get(id);
      return work ? [work] : [];
    });
  };

  /**
   * Candidate Works for the creator's share profile editor. This deliberately
   * uses the same provenance query as featured reads and validation, so the
   * settings surface cannot accidentally offer visitor or mixed-history Works.
   *
   * Selected ids are returned alongside the current page. A creator can keep
   * an older Work selected after it falls outside the newest page, and can
   * still see and withdraw it without making the editor treat the first page
   * as the complete candidate pool.
   */
  listEligibleWorks = async (
    agentId: string,
    {
      includeWorkIds = [],
      limit = 30,
      offset = 0,
    }: { includeWorkIds?: string[]; limit?: number; offset?: number } = {},
  ): Promise<{ hasMore: boolean; items: SharedAgentWork[] }> => {
    const rows = await this.eligibleWorks(agentId)
      .orderBy(desc(works.updatedAt), desc(works.id))
      .limit(limit + 1)
      .offset(offset);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const selectedRows =
      includeWorkIds.length > 0 ? await this.eligibleWorks(agentId, includeWorkIds) : [];
    const allRows = [...selectedRows, ...pageRows];
    const costs = await getTotalCostByWorkIds(
      { db: this.db, userId: this.userId },
      allRows.map(({ id }) => id),
    );
    const byId = new Map(
      allRows.map(({ deliveredAt: _deliveredAt, versionMetadata, ...work }) => {
        const collection =
          work.type === 'collection' ? toSharedCollection(versionMetadata) : undefined;
        return [
          work.id,
          {
            ...work,
            ...(collection ? { collection } : {}),
            totalCost: costs.get(work.id) ?? null,
            url: sanitizeExternalUrl(work.url) ?? null,
          },
        ];
      }),
    );
    const orderedIds = [...includeWorkIds, ...pageRows.map(({ id }) => id)];

    return {
      hasMore,
      items: [...new Set(orderedIds)].flatMap((id) => {
        const work = byId.get(id);
        return work ? [work] : [];
      }),
    };
  };

  getStats = async (agentId: string): Promise<SharedAgentDeliveryStats> => {
    const eligible = this.eligibleWorks(agentId).as('share_eligible_works');
    /** Same cost rule as Work gallery: MAX snapshot per Work/operation, then SUM per Work. */
    const operationKey = sql<string>`coalesce(${workVersions.rootOperationId}, ${workVersions.id}::text)`;
    const operationCosts = this.db
      .select({
        cost: max(workVersions.cumulativeCost).as('operation_cost'),
        workId: workVersions.workId,
      })
      .from(workVersions)
      .innerJoin(eligible, eq(eligible.id, workVersions.workId))
      .groupBy(workVersions.workId, operationKey)
      .as('share_work_operation_costs');
    const workCosts = this.db
      .select({
        cost: sum(operationCosts.cost).as('work_cost'),
        workId: operationCosts.workId,
      })
      .from(operationCosts)
      .groupBy(operationCosts.workId)
      .as('share_work_costs');

    const [workStats, operationStats] = await Promise.all([
      this.db
        .select({
          averageWorkCost: avg(workCosts.cost),
          lastDeliveredAt: sql<Date | null>`max(${eligible.deliveredAt})`.mapWith(
            workVersions.createdAt,
          ),
          workCount: count(),
        })
        .from(eligible)
        .leftJoin(workCosts, eq(workCosts.workId, eligible.id)),
      this.db
        .select({
          duration: sql<
            number | null
          >`avg(extract(epoch from (${agentOperations.completedAt} - ${agentOperations.startedAt})))`.mapWith(
            Number,
          ),
        })
        .from(agentOperations)
        .innerJoin(agents, eq(agents.id, agentOperations.agentId))
        .innerJoin(topics, eq(topics.id, agentOperations.topicId))
        .where(
          and(
            eq(agentOperations.userId, this.userId),
            eq(agentOperations.agentId, agentId),
            eq(agents.userId, this.userId),
            sql`${agents.isDeleted} is not true`,
            inAgentScope(agentOperations.workspaceId),
            eq(topics.userId, this.userId),
            inAgentScope(topics.workspaceId),
            isNull(topics.senderId),
            isNull(topics.deletedAt),
            sql`${topics.isDeleted} is not true`,
            inArray(agentOperations.status, ['done', 'error', 'interrupted', 'abandoned']),
            sql`${agentOperations.completedAt} >= ${agentOperations.startedAt}`,
          ),
        ),
    ]);
    return {
      averageOperationDurationSeconds: operationStats[0]?.duration ?? null,
      averageWorkCost:
        workStats[0]?.averageWorkCost == null ? null : Number(workStats[0].averageWorkCost),
      lastDeliveredAt: workStats[0]?.lastDeliveredAt ?? null,
      workCount: workStats[0]?.workCount ?? 0,
    };
  };
}

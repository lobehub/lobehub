import { and, asc, count, eq, isNull } from 'drizzle-orm';

import { threads, topics, userInstalledPlugins } from '@/database/schemas';

import { BaseService } from '../common/base.service';
import type { EvalPagination } from '../types/eval-resource.type';
import { evalPagination } from '../types/eval-resource.type';

export class EvalContextService extends BaseService {
  async listThreads(topicId: string, query: EvalPagination) {
    const [topic] = await this.db
      .select({ id: topics.id })
      .from(topics)
      .where(
        and(eq(topics.id, topicId), this.buildWorkspaceWhere(topics), isNull(topics.deletedAt)),
      )
      .limit(1);
    if (!topic) throw this.createNotFoundError('Topic not found');
    const permission = await this.resolveOperationPermission('MESSAGE_READ', {
      targetTopicId: topicId,
    });
    if (!permission.isPermitted)
      throw this.createAuthorizationError('No permission to read topic threads');
    const where = and(
      eq(threads.topicId, topicId),
      this.buildWorkspaceWhere(threads),
      isNull(threads.deletedAt),
    );
    const { limit, offset } = evalPagination(query);
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          id: threads.id,
          topicId: threads.topicId,
          title: threads.title,
          type: threads.type,
          status: threads.status,
          parentThreadId: threads.parentThreadId,
          createdAt: threads.createdAt,
          updatedAt: threads.updatedAt,
        })
        .from(threads)
        .where(where)
        .orderBy(asc(threads.createdAt), asc(threads.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(threads).where(where),
    ]);
    return { threads: rows, total: totals[0].total };
  }
  async listPlugins(query: EvalPagination) {
    const where = this.buildWorkspaceWhere(userInstalledPlugins);
    const { limit, offset } = evalPagination(query);
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          identifier: userInstalledPlugins.identifier,
          type: userInstalledPlugins.type,
          createdAt: userInstalledPlugins.createdAt,
          updatedAt: userInstalledPlugins.updatedAt,
        })
        .from(userInstalledPlugins)
        .where(where)
        .orderBy(asc(userInstalledPlugins.identifier), asc(userInstalledPlugins.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(userInstalledPlugins).where(where),
    ]);
    // Credentials, settings, custom connection parameters and manifests are not
    // public capability metadata. Only the actual installed inventory is exposed.
    return { plugins: rows, total: totals[0].total };
  }
}

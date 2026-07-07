import { and, desc, eq, gte, ilike, inArray, lt, lte, or } from 'drizzle-orm';

import { workspaceAuditLogs } from '../schemas/workspace';
import type { LobeChatDatabase } from '../type';

export type WorkspaceAuditAction =
  | 'workspace.created'
  | 'workspace.updated'
  | 'workspace.upgraded'
  | 'workspace.downgraded'
  | 'workspace.primary_ownership_transferred'
  | 'workspace.deleted'
  | 'workspace.cleanup_triggered'
  | 'workspace.account_upgraded'
  | 'workspace.frozen'
  | 'workspace.unfrozen'
  | 'workspace.data_cleared'
  | 'workspace.settings_reset'
  | 'member.invited'
  | 'member.removed'
  | 'member.role_updated'
  | 'member.joined'
  | 'member.left'
  | 'member.promoted_to_owner'
  | 'member.demoted_from_owner'
  | 'invitation.revoked'
  | 'invitation.resent'
  | 'budget.default_member_limit_updated'
  | 'budget.member_limit_updated'
  | 'budget.member_override_created'
  | 'budget.member_override_updated'
  | 'budget.member_override_removed'
  | 'auto_top_up.enabled'
  | 'auto_top_up.updated'
  | 'auto_top_up.disabled'
  | 'auto_top_up.succeeded'
  | 'auto_top_up.failed'
  | 'top_up.succeeded'
  | 'provider.enabled'
  | 'provider.disabled'
  | 'provider.updated'
  | 'credential.created'
  | 'credential.updated'
  | 'credential.deleted'
  | 'credential.tested'
  | 'api_key.created'
  | 'api_key.renamed'
  | 'api_key.rotated'
  | 'api_key.revoked'
  | 'resource.created'
  | 'resource.updated'
  | 'resource.deleted'
  | 'resource.restored'
  | 'resource.transferred'
  | 'resource.shared'
  | 'resource.unshared'
  | 'resource.imported'
  | 'resource.exported'
  | 'security.policy_updated'
  | 'security.risk_state_updated'
  | 'integration.connected'
  | 'integration.updated'
  | 'integration.disabled'
  | 'integration.disconnected'
  | 'webhook.created'
  | 'webhook.updated'
  | 'webhook.deleted'
  | 'market_identity.updated'
  | 'market_identity.published'
  | 'market_identity.unpublished'
  | 'subscription.activated'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'subscription.cancellation_scheduled'
  | 'subscription.cancellation_resumed'
  | 'subscription.grace_period_started'
  | 'billing.portal_session_created'
  | 'billing.payment_method_added'
  | 'billing.payment_method_removed'
  | 'billing.default_payment_method_changed';

interface CreateAuditLogParams {
  action: WorkspaceAuditAction;
  ipAddress?: string;
  metadata?: Record<string, any>;
  resourceId?: string;
  resourceType?: string;
  userId: string | null;
  workspaceId: string;
}

interface ListAuditLogParams {
  action?: WorkspaceAuditAction;
  cursor?: Date;
  endDate?: Date;
  limit?: number;
  q?: string;
  resourceType?: string;
  startDate?: Date;
  userIds?: string[];
  workspaceId: string;
}

export class WorkspaceAuditLogModel {
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  create = async (params: CreateAuditLogParams) => {
    const [row] = await this.db
      .insert(workspaceAuditLogs)
      .values({
        action: params.action,
        ipAddress: params.ipAddress,
        metadata: params.metadata ?? {},
        resourceId: params.resourceId,
        resourceType: params.resourceType,
        userId: params.userId,
        workspaceId: params.workspaceId,
      })
      .returning();
    return row;
  };

  list = async (params: ListAuditLogParams) => {
    const {
      workspaceId,
      action,
      resourceType,
      startDate,
      endDate,
      cursor,
      q,
      userIds = [],
      limit = 50,
    } = params;
    const conditions = [eq(workspaceAuditLogs.workspaceId, workspaceId)];
    if (action) conditions.push(eq(workspaceAuditLogs.action, action));
    if (resourceType) conditions.push(eq(workspaceAuditLogs.resourceType, resourceType));
    if (startDate) conditions.push(gte(workspaceAuditLogs.createdAt, startDate));
    if (endDate) conditions.push(lte(workspaceAuditLogs.createdAt, endDate));
    if (cursor) conditions.push(lt(workspaceAuditLogs.createdAt, cursor));
    const keyword = q?.trim();
    if (keyword) {
      const searchConditions = [
        ilike(workspaceAuditLogs.action, `%${keyword}%`),
        ilike(workspaceAuditLogs.resourceType, `%${keyword}%`),
        ilike(workspaceAuditLogs.resourceId, `%${keyword}%`),
        ilike(workspaceAuditLogs.ipAddress, `%${keyword}%`),
      ];
      if (userIds.length > 0) searchConditions.push(inArray(workspaceAuditLogs.userId, userIds));
      conditions.push(or(...searchConditions)!);
    }

    const rows = await this.db.query.workspaceAuditLogs.findMany({
      limit: limit + 1,
      orderBy: [desc(workspaceAuditLogs.createdAt)],
      where: and(...conditions),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items.at(-1)?.createdAt?.toISOString() : null;

    return { items, nextCursor };
  };
}

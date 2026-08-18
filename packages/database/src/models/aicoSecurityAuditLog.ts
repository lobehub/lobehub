import { aicoSecurityAuditLogs } from '../schemas/aicoOrganization';
import type { LobeChatDatabase, Transaction } from '../type';

export type AicoSecurityAuditAction =
  | 'platform.org.create'
  | 'platform.org.suspend'
  | 'platform.org.activate'
  | 'platform.org.assign_manager'
  | 'platform.credit.org_add'
  | 'platform.credit.user_add'
  | 'platform.admin.add'
  | 'org.member.invite'
  | 'org.member.remove'
  | 'org.member.role_update'
  | 'org.key.reclaim_member'
  | 'org.key.disable_all'
  | 'auth.rate_limit'
  | 'auth.otp_verify_fail';

export type AicoSecurityAuditResult = 'success' | 'failure';

export type AicoSecurityAuditSource = 'trpc' | 'job' | 'auth' | 'system';

export interface RecordAicoSecurityEventParams {
  action: AicoSecurityAuditAction | (string & {});
  actorAdminId?: string | null;
  actorUserId?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
  organizationId?: string | null;
  result?: AicoSecurityAuditResult;
  source?: AicoSecurityAuditSource;
  targetId?: string | null;
  targetType?: string | null;
  userAgent?: string | null;
}

export class AicoSecurityAuditLogModel {
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  create = async (params: RecordAicoSecurityEventParams, trx?: Transaction) => {
    const [row] = await (trx ?? this.db)
      .insert(aicoSecurityAuditLogs)
      .values({
        action: params.action,
        actorAdminId: params.actorAdminId ?? null,
        actorUserId: params.actorUserId ?? null,
        ipAddress: params.ipAddress ?? null,
        metadata: params.metadata ?? {},
        organizationId: params.organizationId ?? null,
        result: params.result ?? 'success',
        source: params.source ?? 'trpc',
        targetId: params.targetId ?? null,
        targetType: params.targetType ?? null,
        userAgent: params.userAgent ?? null,
      })
      .returning();
    return row;
  };
}

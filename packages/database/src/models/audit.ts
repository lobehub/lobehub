import { randomUUID } from 'node:crypto';

import { LobeChatDatabase } from '../type';
import { auditLogs } from '../schemas/audit';

export class AuditModel {
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  /**
   * Write an audit record.
   * details: arbitrary JSON-serializable object (stored as jsonb)
   */
  async log(options: {
    actorId: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    subjectUserId?: string | null;
    workspaceId?: string | null;
    details?: Record<string, unknown> | null;
  }) {
    const id = randomUUID();

    await this.db.insert(auditLogs).values({
      id,
      actorId: options.actorId,
      action: options.action,
      targetType: options.targetType,
      targetId: options.targetId ?? null,
      subjectUserId: options.subjectUserId ?? null,
      workspaceId: options.workspaceId ?? null,
      details: options.details ?? null,
    });

    return true;
  }

  async queryRecent(limit = 50) {
    return this.db.query.auditLogs.findMany({ limit, orderBy: (b) => b.createdAt.desc() as any });
  }
}

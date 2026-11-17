import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import type { LobeChatDatabase } from '@/database/type';

/** The write actions on devices and sandboxes the REST API records. */
export type DeviceAuditAction =
  | 'device.command_executed'
  | 'device.file_written'
  | 'device.git_operated'
  | 'sandbox.command_executed'
  | 'sandbox.created'
  | 'sandbox.file_written';

/** Who performed a write, as the request authenticated it. */
export interface DeviceAuditActor {
  /** The API key the call was signed with, when it was one. */
  apiKeyId?: string;
  authType?: string;
  ipAddress?: string;
  userId: string;
  workspaceId?: string;
}

export interface DeviceAuditEntry {
  action: DeviceAuditAction;
  metadata: Record<string, unknown>;
  resourceId: string;
  resourceType: 'device' | 'sandbox';
}

/**
 * Record one device or sandbox write. Every write on these surfaces goes
 * through here before its result is returned.
 *
 * - In a workspace the entry lands in `workspace_audit_logs`, next to the
 *   workspace's other security events, where owners already read them.
 * - A personal account has no audit table, so the entry is written to the
 *   server log as one structured `[openapi:audit]` line.
 *
 * Both carry the same fields. Recording is awaited, so a write is never
 * reported as done while its audit entry is still in flight; a failed insert
 * is logged rather than turning a write that already happened into an error.
 */
export const recordDeviceAudit = async (
  db: LobeChatDatabase,
  actor: DeviceAuditActor,
  entry: DeviceAuditEntry,
) => {
  const metadata = {
    ...entry.metadata,
    apiKeyId: actor.apiKeyId ?? null,
    authType: actor.authType ?? null,
    via: 'openapi',
  };

  console.info(
    '[openapi:audit]',
    JSON.stringify({
      action: entry.action,
      ipAddress: actor.ipAddress ?? null,
      metadata,
      resourceId: entry.resourceId,
      resourceType: entry.resourceType,
      userId: actor.userId,
      workspaceId: actor.workspaceId ?? null,
    }),
  );

  if (!actor.workspaceId) return;

  try {
    await new WorkspaceAuditLogModel(db).create({
      action: entry.action,
      ipAddress: actor.ipAddress,
      metadata,
      resourceId: entry.resourceId,
      resourceType: entry.resourceType,
      userId: actor.userId,
      workspaceId: actor.workspaceId,
    });
  } catch (error) {
    console.error('[openapi:audit] failed to store the audit entry', entry.action, error);
  }
};

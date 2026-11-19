import { createHash } from 'node:crypto';

import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import type { LobeChatDatabase } from '@/database/type';
import { redactSandboxParams } from '@/server/services/sandbox/providers/market';

/** The write actions on devices and sandboxes the REST API records. */
export type DeviceAuditAction =
  | 'device.command_executed'
  | 'device.file_written'
  | 'device.git_operated'
  | 'sandbox.command_executed'
  | 'sandbox.created'
  | 'sandbox.file_written';

const REDACTED = '[redacted]';

/** `NAME=value` where the name says it holds a secret (`OPENAI_API_KEY`, `DB_PASSWORD`, …). */
const SECRET_ASSIGNMENT =
  /\b([A-Za-z_][\w]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|PASS|AUTH|CREDENTIALS?|SESSION|COOKIE)[\w]*)=("[^"]*"|'[^']*'|\S+)/gi;
/** `--token value`, `--password=value`, `-H "Authorization: Bearer …"` and friends. */
const SECRET_FLAG =
  /(--?(?:[\w-]*(?:token|secret|password|passwd|api-?key|auth)[\w-]*)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi;
const BEARER = /\b(Bearer|Basic|token)\s+[\w.~+/=-]{8,}/gi;
/** Credentials inside a URL: `https://user:secret@host`. */
const URL_CREDENTIALS = /(\w+:\/\/[^/\s:@]+:)[^@\s]+@/g;
/** Token shapes common enough to recognize on their own. */
const TOKEN_LITERAL =
  /\b(?:sk-[\w-]{16,}|sk-lh-[a-z0-9]{16}|gh[pousr]_\w{20,}|github_pat_\w{20,}|xox[abpr]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]+)\b/g;

/**
 * What an audit entry keeps of a command line: the command with anything
 * credential-shaped blanked — the sandbox layer's known variables, any
 * `*_KEY` / `*_TOKEN` / `*PASSWORD*` assignment, secret-looking flags, bearer
 * headers, URL userinfo and recognizable token literals — plus a SHA-256 of
 * the original, so the exact command can still be matched without the audit
 * log (or the server log, for a personal account) holding a usable secret.
 */
export const redactCommandForAudit = (command: string) => {
  const redacted = (redactSandboxParams({ command }).command as string)
    .replaceAll(SECRET_ASSIGNMENT, (_, name: string) => `${name}=${REDACTED}`)
    .replaceAll(SECRET_FLAG, (_, flag: string) => `${flag}${REDACTED}`)
    .replaceAll(BEARER, (_, scheme: string) => `${scheme} ${REDACTED}`)
    .replaceAll(URL_CREDENTIALS, (_, prefix: string) => `${prefix}${REDACTED}@`)
    .replaceAll(TOKEN_LITERAL, REDACTED);

  return {
    command: redacted,
    commandSha256: createHash('sha256').update(command).digest('hex'),
  };
};

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
    ...(typeof entry.metadata.command === 'string' &&
      redactCommandForAudit(entry.metadata.command)),
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

/**
 * Run one write and record it whatever happens: a refusal or an error thrown
 * on the way is an attempt the audit log must still show, with its reason.
 */
export const runAudited = async <T>(
  audit: (entry: Omit<DeviceAuditEntry, 'resourceType'>) => Promise<void>,
  entry: Omit<DeviceAuditEntry, 'resourceType'>,
  work: () => Promise<T>,
  outcome: (result: T) => Record<string, unknown>,
): Promise<T> => {
  try {
    const result = await work();
    await audit({ ...entry, metadata: { ...entry.metadata, ...outcome(result) } });
    return result;
  } catch (error) {
    await audit({
      ...entry,
      metadata: {
        ...entry.metadata,
        error: error instanceof Error ? error.message : String(error),
        success: false,
      },
    });
    throw error;
  }
};

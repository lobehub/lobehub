import type { ChatTopicBotContext } from '@lobechat/types';
import debug from 'debug';

import type { DeviceAccessReason } from './deviceAccessPolicy';

export type { DeviceAccessReason } from './deviceAccessPolicy';

const log = debug('lobe-server:agent-device-tool-audit');

/**
 * Identifiers we treat as device tools — kept inline to avoid pulling the
 * whole builtin-tool packages just to read their identifier strings.
 * If either package's identifier ever changes, the static string here will
 * fall behind the import in `aiAgent/index.ts`; the test in
 * `__tests__/deviceToolAudit.test.ts` (if added) should pin both.
 */
const DEVICE_TOOL_IDENTIFIERS = new Set(['local-system', 'remote-device']);

export const isDeviceToolIdentifier = (identifier: string): boolean =>
  DEVICE_TOOL_IDENTIFIERS.has(identifier);

export interface DeviceToolAuditEntry {
  apiName: string;
  canUseDevice: boolean;
  isOwner: boolean | null;
  messageId?: string;
  operationId?: string;
  /** `null` for first-party UI calls (no bot platform). */
  platform: string | null;
  reason: DeviceAccessReason;
  /** `null` for first-party UI calls (no external sender). */
  senderExternalUserId: string | null;
  toolIdentifier: string;
  topicId?: string;
  userId?: string;
}

export interface LogDeviceToolAuditParams {
  apiName: string;
  botContext?: ChatTopicBotContext;
  canUseDevice: boolean;
  messageId?: string;
  operationId?: string;
  reason: DeviceAccessReason;
  toolIdentifier: string;
  topicId?: string;
  userId?: string;
}

/**
 * Emit one audit record per device-tool dispatch. Caller is responsible for
 * gating on `isDeviceToolIdentifier(...)` first — calling this for non-device
 * tools is a no-op contract violation, not a runtime guard.
 *
 * Reason for being a logger (not a DB table): the goal here is post-incident
 * forensics ("who triggered this read_file?"), not real-time risk control.
 * The debug namespace keeps it cheap, fire-and-forget, and consistent with
 * the existing `lobe-server:device-proxy` line at the actual proxy dispatch.
 *
 * Sensitive payloads (file contents, shell stdout, tool args) are NEVER
 * recorded here — only identity + decision metadata.
 */
export const logDeviceToolAudit = (params: LogDeviceToolAuditParams): void => {
  const { botContext, canUseDevice, reason, ...rest } = params;
  const entry: DeviceToolAuditEntry = {
    ...rest,
    canUseDevice,
    isOwner: botContext ? botContext.isOwner : null,
    platform: botContext?.platform ?? null,
    reason,
    senderExternalUserId: botContext?.senderExternalUserId ?? null,
  };
  log(
    'device-tool-call %s:%s userId=%s topicId=%s operationId=%s platform=%s sender=%s isOwner=%s reason=%s canUseDevice=%s',
    entry.toolIdentifier,
    entry.apiName,
    entry.userId ?? '-',
    entry.topicId ?? '-',
    entry.operationId ?? '-',
    entry.platform ?? '-',
    entry.senderExternalUserId ?? '-',
    entry.isOwner === null ? '-' : entry.isOwner,
    entry.reason,
    entry.canUseDevice,
  );
};

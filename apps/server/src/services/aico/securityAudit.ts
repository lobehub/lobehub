import debug from 'debug';

import type { RecordAicoSecurityEventParams } from '@/database/models/aicoSecurityAuditLog';
import { AicoSecurityAuditLogModel } from '@/database/models/aicoSecurityAuditLog';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-aico:security-audit');

/**
 * Best-effort security audit write (MON-002). Never throws to callers.
 */
export const recordAicoSecurityEvent = async (
  db: LobeChatDatabase,
  params: RecordAicoSecurityEventParams,
): Promise<void> => {
  try {
    await new AicoSecurityAuditLogModel(db).create(params);
  } catch (error) {
    log('failed to write security audit event %s %O', params.action, error);
  }
};

import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { insertLog } from './logsRepository';
import { isGovernanceEnabled } from './policyGate';
import type { CommandGovernanceContext, CommandGovernanceOutcome } from './types';

const log = debug('lobe-server:governance:audit-logger');

/**
 * Persist one row to `command_execution_logs`. No-op when governance is
 * disabled (same flag as `policyGate.isGovernanceEnabled`) — zero DB calls on
 * the hot path when the feature is off.
 *
 * Callers must never let a logging failure mask the real tool result: this
 * function does not throw — a DB error here is swallowed and debug-logged
 * only, matching the fail-open posture of `checkCommand`.
 */
export const logCommandExecution = async (
  ctx: CommandGovernanceContext,
  outcome: CommandGovernanceOutcome,
  db: LobeChatDatabase,
): Promise<void> => {
  if (!isGovernanceEnabled()) return;

  try {
    await insertLog(db, { ...ctx, outcome });
  } catch (error) {
    log('Failed to persist command execution audit log for user %s: %O', ctx.userId, error);
  }
};

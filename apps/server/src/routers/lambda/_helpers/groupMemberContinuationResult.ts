import type { ExecAgentResult } from '@lobechat/types';

/**
 * Client-facing shape of an `execAgent` result.
 *
 * A group member's approval continuation runs under the supervisor's run, and
 * the supervisor keeps the topic and its stream. Clients released before that
 * existed take any returned `operationId` as the topic's new run: they replace
 * the topic marker and drop the supervisor's socket, losing the supervisor's
 * closing. So the response names the supervisor's run as `operationId` (safe
 * for those clients: they keep following it) and carries the member's
 * continuation as `memberOperationId` for clients that understand
 * `groupMemberContinuation`. Every other result passes through unchanged.
 */
export const toClientExecAgentResult = <T extends ExecAgentResult>(result: T): T => {
  const { supervisorOperationId, ...rest } = result;
  if (!result.groupMemberContinuation || !supervisorOperationId) return rest as T;

  return {
    ...rest,
    memberOperationId: result.operationId,
    operationId: supervisorOperationId,
  } as T;
};

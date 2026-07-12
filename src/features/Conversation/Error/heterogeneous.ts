import {
  type HeterogeneousAgentSessionError,
  HeterogeneousAgentSessionErrorCode,
} from '@lobechat/electron-client-ipc';
import type { UIChatMessage } from '@lobechat/types';

/**
 * Heterogeneous-agent (Claude Code / Codex) session errors that render the
 * dedicated status-guide card (auth required, CLI missing, overload, rate
 * limit). Kept in this dependency-free module so non-React callers (e.g. the
 * message action bar) can branch on them without pulling the whole Error UI
 * barrel.
 */
export const HETEROGENEOUS_AGENT_STATUS_GUIDE_ERROR_CODES = new Set<string>([
  HeterogeneousAgentSessionErrorCode.AuthRequired,
  HeterogeneousAgentSessionErrorCode.CliNotFound,
  HeterogeneousAgentSessionErrorCode.Overloaded,
  HeterogeneousAgentSessionErrorCode.RateLimit,
]);

export const isHeterogeneousAgentStatusGuideError = (
  value: unknown,
): value is HeterogeneousAgentSessionError => {
  if (!value || typeof value !== 'object') return false;

  const { agentType, code } = value as Partial<HeterogeneousAgentSessionError>;

  return (
    (agentType === 'claude-code' || agentType === 'codex') &&
    typeof code === 'string' &&
    HETEROGENEOUS_AGENT_STATUS_GUIDE_ERROR_CODES.has(code)
  );
};

/**
 * Id of the single failed step at the tail of a heterogeneous run, when that
 * step can be dropped on its own without taking the rest of the run with it.
 *
 * A hetero (CC/Codex) turn renders as ONE `assistantGroup` bubble whose
 * `children` are the run's real steps, so acting on the group id acts on the
 * whole run. Returns undefined — meaning "operate on the whole group" — when:
 * - the message isn't a hetero run's group bubble;
 * - its tail step died on something other than a hetero status error (a generic
 *   tool/provider failure isn't a resumable run);
 * - the tail step IS the group head, i.e. the run died on its first step. Its id
 *   doubles as the group id, and no earlier work exists to preserve.
 */
export const resolveHeteroErroredStepId = (
  message: UIChatMessage | undefined,
): string | undefined => {
  if (message?.role !== 'assistantGroup') return;

  const tail = message.children?.at(-1);
  if (!tail || tail.id === message.id) return;

  return tail.error && isHeterogeneousAgentStatusGuideError(tail.error.body) ? tail.id : undefined;
};

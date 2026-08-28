import {
  type HeterogeneousAgentSessionError,
  HeterogeneousAgentSessionErrorCode,
} from '@lobechat/electron-client-ipc';

/**
 * Heterogeneous CLI-agent session errors that render the
 * dedicated status-guide card (auth required, CLI missing, overload, rate
 * limit). Kept in this dependency-free module so non-React callers (e.g. the
 * conversation store's retry logic) can branch on them without pulling the whole Error UI
 * barrel.
 */
export const HETEROGENEOUS_AGENT_STATUS_GUIDE_ERROR_CODES = new Set<string>([
  HeterogeneousAgentSessionErrorCode.AuthRequired,
  HeterogeneousAgentSessionErrorCode.CliNotFound,
  HeterogeneousAgentSessionErrorCode.Overloaded,
  HeterogeneousAgentSessionErrorCode.RateLimit,
  HeterogeneousAgentSessionErrorCode.WorkingDirectoryNotFound,
]);

export const isHeterogeneousAgentStatusGuideError = (
  value: unknown,
): value is HeterogeneousAgentSessionError => {
  if (!value || typeof value !== 'object') return false;

  const { agentType, code } = value as Partial<HeterogeneousAgentSessionError>;

  return (
    (agentType === 'amp' ||
      agentType === 'claude-code' ||
      agentType === 'codebuddy' ||
      agentType === 'codex' ||
      agentType === 'cursor' ||
      agentType === 'grok-build' ||
      agentType === 'kimi-code' ||
      agentType === 'opencode' ||
      agentType === 'pi' ||
      agentType === 'qoder' ||
      agentType === 'trae') &&
    typeof code === 'string' &&
    HETEROGENEOUS_AGENT_STATUS_GUIDE_ERROR_CODES.has(code)
  );
};

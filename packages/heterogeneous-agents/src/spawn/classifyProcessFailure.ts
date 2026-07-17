import type { HeterogeneousTerminalErrorData } from '../types';

/**
 * Process-level failure classification for `lh hetero exec` runs.
 *
 * The stream adapters (`adapters/claudeCode.ts`, `adapters/codex.ts`) classify
 * failures the CLI reports in-stream (overloaded / rate-limit / auth relayed
 * via a `result` event), but a run that dies BEFORE the agent CLI produces any
 * stream — `spawn claude ENOENT`, an auth failure printed straight to stderr —
 * never reaches an adapter. Without classification those runs land on the
 * server as a bare `{ message }` error, so the client renders the generic JSON
 * error card instead of the heterogeneous status guide (install CLI / sign in).
 *
 * This helper mirrors the desktop in-process classifier
 * (`HeterogeneousAgentCtr.getSessionErrorPayload`) for the two guide codes a
 * process-level failure can produce: `cli_not_found` and `auth_required`.
 * The returned shape is persisted verbatim as the `ChatMessageError.body`, so
 * it must carry `agentType` + `code` — that pair is what
 * `isHeterogeneousAgentStatusGuideError` gates the dedicated UI on.
 */

/**
 * Node reports a missing executable as an `ErrnoException` with
 * `code: 'ENOENT'` and message `spawn <command> ENOENT`. When only stderr text
 * is available (the raw error object was already flattened into the stderr
 * tail), match the message shape instead. Note ENOENT is also raised for a
 * missing `cwd` — same behavior as the desktop classifier; both mean "this
 * machine can't start the CLI as configured".
 */
const SPAWN_ENOENT_PATTERN = /\bspawn .+ ENOENT\b/;

/** Mirrors `CLI_AUTH_REQUIRED_PATTERNS` in the desktop `HeterogeneousAgentCtr`. */
const CLI_AUTH_REQUIRED_PATTERNS = [
  /failed to authenticate/i,
  /invalid authentication credentials/i,
  /authentication[_ ]error/i,
  /not authenticated/i,
  /\bunauthorized\b/i,
  /\b401\b/,
];

const CLI_NOT_FOUND_MESSAGES: Record<string, string> = {
  'claude-code':
    'Claude Code CLI was not found on the machine running this agent. Install it and make sure `claude` can be executed.',
  'codex':
    'Codex CLI was not found on the machine running this agent. Install it and make sure `codex` can be executed.',
};

const AUTH_REQUIRED_MESSAGES: Record<string, string> = {
  'claude-code':
    'Claude Code could not authenticate on the machine running this agent. Sign in again or refresh its credentials, then retry.',
  'codex':
    'Codex could not authenticate on the machine running this agent. Sign in again or refresh its credentials, then retry.',
};

/**
 * Codes/agent types the client renders the dedicated status-guide card for.
 * Must stay in sync with `HETEROGENEOUS_AGENT_STATUS_GUIDE_ERROR_CODES` in
 * `src/features/Conversation/Error/heterogeneous.ts` — that predicate gates the
 * guide UI on the same `agentType` + `code` pair.
 */
const STATUS_GUIDE_ERROR_CODES = new Set([
  'auth_required',
  'cli_not_found',
  'overloaded',
  'rate_limit',
]);
const STATUS_GUIDE_AGENT_TYPES = new Set(['amp', 'claude-code', 'codex']);

/**
 * Whether a terminal error payload (an adapter's in-stream `error` event data,
 * or a persisted `ChatMessageError.body`) is a structured status-guide error —
 * i.e. carries the `agentType` + `code` pair the client's guide UI gates on.
 */
export const isHeteroStatusGuideErrorData = (
  value: unknown,
): value is HeterogeneousTerminalErrorData & { agentType: string; code: string } => {
  if (!value || typeof value !== 'object') return false;

  const { agentType, code } = value as HeterogeneousTerminalErrorData;

  return (
    typeof agentType === 'string' &&
    STATUS_GUIDE_AGENT_TYPES.has(agentType) &&
    typeof code === 'string' &&
    STATUS_GUIDE_ERROR_CODES.has(code)
  );
};

export interface ClassifyHeteroProcessFailureParams {
  /** Adapter type key — only `claude-code` / `codex` have a status guide. */
  agentType: string;
  /** Stderr tail / flattened error message to pattern-match. */
  detail?: string;
  /**
   * `err.code` from the raw Node `ErrnoException`, when the caller still has
   * the error object (more precise than matching the message text).
   */
  errnoCode?: string;
}

/**
 * Classify a process-level run failure into a structured status-guide error,
 * or `undefined` when the failure isn't one the guide UI can act on (the
 * caller should then keep its flat `{ message }` error).
 */
export const classifyHeteroProcessFailure = (
  params: ClassifyHeteroProcessFailureParams,
): HeterogeneousTerminalErrorData | undefined => {
  const { agentType, errnoCode } = params;
  const detail = params.detail?.trim();

  const cliNotFoundMessage = CLI_NOT_FOUND_MESSAGES[agentType];
  // Unknown agent type → the client guide can't render it; don't classify.
  if (!cliNotFoundMessage) return;

  if (errnoCode === 'ENOENT' || (detail && SPAWN_ENOENT_PATTERN.test(detail))) {
    return {
      agentType,
      code: 'cli_not_found',
      message: cliNotFoundMessage,
      ...(detail ? { stderr: detail } : {}),
    };
  }

  if (detail && CLI_AUTH_REQUIRED_PATTERNS.some((pattern) => pattern.test(detail))) {
    return {
      agentType,
      code: 'auth_required',
      message: AUTH_REQUIRED_MESSAGES[agentType],
      stderr: detail,
    };
  }
};

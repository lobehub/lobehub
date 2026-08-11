import {
  buildHeterogeneousAgentAuthRequiredError,
  buildHeterogeneousAgentCliNotFoundError,
  HETEROGENEOUS_AGENT_CONFIGS,
  isHeterogeneousAgentAuthRequired,
  isLocalHeterogeneousType,
} from '../config';
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
 * process-level failure can produce: `cli_not_found`,
 * `working_directory_not_found`, and `auth_required`.
 * The returned shape is persisted verbatim as the `ChatMessageError.body`, so
 * it must carry `agentType` + `code` — that pair is what
 * `isHeterogeneousAgentStatusGuideError` gates the dedicated UI on.
 */

/**
 * Node reports a missing executable as an `ErrnoException` with
 * `code: 'ENOENT'` and message `spawn <command> ENOENT`. When only stderr text
 * is available (the raw error object was already flattened into the stderr
 * tail), match the message shape instead. A missing `cwd` also produces
 * ENOENT, so spawn sites validate it first and surface a distinct code.
 */
const SPAWN_ENOENT_PATTERN = /\bspawn .+ ENOENT\b/;

export const HETERO_WORKING_DIRECTORY_NOT_FOUND = 'HETERO_WORKING_DIRECTORY_NOT_FOUND';
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
  'working_directory_not_found',
]);
const STATUS_GUIDE_AGENT_TYPES = new Set(
  HETEROGENEOUS_AGENT_CONFIGS.map(({ type }) => type as string),
);

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
  /** Adapter type key for a local CLI with a status guide. */
  agentType: string;
  /** Configured CLI command, when the caller overrides the descriptor default. */
  command?: string;
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
  const { agentType, command, errnoCode } = params;
  const detail = params.detail?.trim();

  // Unknown agent type → the client guide can't render it; don't classify.
  if (!isLocalHeterogeneousType(agentType)) return;

  if (errnoCode === HETERO_WORKING_DIRECTORY_NOT_FOUND) {
    return {
      agentType,
      code: 'working_directory_not_found',
      message: detail || 'The configured working directory no longer exists.',
      ...(detail ? { stderr: detail } : {}),
    };
  }

  if (errnoCode === 'ENOENT' || (detail && SPAWN_ENOENT_PATTERN.test(detail))) {
    return buildHeterogeneousAgentCliNotFoundError({
      agentType,
      command,
      stderr: detail,
    });
  }

  if (detail && isHeterogeneousAgentAuthRequired(agentType, detail)) {
    return buildHeterogeneousAgentAuthRequiredError({
      agentType,
      command,
      stderr: detail,
    });
  }
};

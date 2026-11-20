import pc from 'picocolors';

/**
 * How `lh agent run` ended, as far as the CLI could establish it.
 *
 * - `completed`: the run reached `done`
 * - `failed`: the run reached `error`
 * - `interrupted`: the run was cancelled / interrupted
 * - `waiting_for_human`: the run is parked on a human approval or prompt
 * - `unknown`: the CLI could not confirm an outcome (no status, unreadable
 *   status, status probes kept failing, or the wait timed out). The run may
 *   still be executing server-side.
 */
export type AgentRunOutcomeKind =
  'completed' | 'failed' | 'interrupted' | 'unknown' | 'waiting_for_human';

export interface AgentRunOutcome {
  error?: string;
  kind: AgentRunOutcomeKind;
  /** Raw status / end reason the outcome was derived from, when there was one */
  status?: string;
}

/**
 * Exit status contract of `lh agent run`. Scripts can tell a parked run apart
 * from a finished one, and both apart from a run the CLI could not confirm.
 */
export const AGENT_RUN_EXIT_CODES: Record<AgentRunOutcomeKind, number> = {
  completed: 0,
  failed: 1,
  interrupted: 1,
  unknown: 3,
  waiting_for_human: 2,
};

const COMPLETED_STATUSES = new Set(['completed', 'done', 'success']);
const FAILED_STATUSES = new Set(['error', 'failed']);
const INTERRUPTED_STATUSES = new Set(['aborted', 'canceled', 'cancelled', 'interrupted']);
/** Non-terminal runtime statuses: the run is still going (or about to resume). */
const ACTIVE_STATUSES = new Set([
  'idle',
  'pending',
  'processing',
  'running',
  'waiting_for_async_tool',
]);

/**
 * Classify a runtime status or `agent_runtime_end` reason. Returns `active`
 * for a run that is still going and `undefined` for a value the CLI does not
 * recognise.
 */
export const classifyRunStatus = (
  status: string | undefined,
): AgentRunOutcomeKind | 'active' | undefined => {
  if (!status) return undefined;
  if (COMPLETED_STATUSES.has(status)) return 'completed';
  if (FAILED_STATUSES.has(status)) return 'failed';
  if (INTERRUPTED_STATUSES.has(status)) return 'interrupted';
  if (status === 'waiting_for_human') return 'waiting_for_human';
  if (ACTIVE_STATUSES.has(status)) return 'active';
  return undefined;
};

export interface ReadOperationStatus {
  cost?: { total?: number };
  error?: string;
  status?: string;
  stepCount?: number;
  usage?: { total_tokens?: number };
}

const errorText = (error: unknown): string | undefined => {
  if (!error) return undefined;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error) return String((error as any).message);
  return JSON.stringify(error);
};

/**
 * Read `aiAgent.getOperationStatus`. The server answers with an envelope —
 * `{ currentState: { status, stepCount, usage, cost, error }, isCompleted,
 * hasError, needsHumanInput, isActive, ... }` — so the run's fields live under
 * `currentState`, not at the top level. The flat reads are kept as fallbacks
 * for older servers, and the envelope's summary flags stand in when there is
 * no status string at all.
 */
export const readOperationStatus = (r: any): ReadOperationStatus => {
  const state = r?.currentState ?? {};
  let status: string | undefined = state.status ?? r?.status ?? r?.state;

  if (!status) {
    if (r?.isCompleted) status = r.hasError ? 'error' : 'done';
    else if (r?.needsHumanInput) status = 'waiting_for_human';
    else if (r?.isActive) status = 'running';
  }

  return {
    cost: state.cost ?? r?.cost,
    error: errorText(state.error ?? r?.error),
    status,
    stepCount: state.stepCount ?? r?.stepCount ?? r?.stats?.totalSteps,
    usage: state.usage ?? r?.usage,
  };
};

export const colorStatus = (status: string): string => {
  switch (classifyRunStatus(status)) {
    case 'completed': {
      return pc.green(status);
    }
    case 'failed': {
      return pc.red(status);
    }
    case 'interrupted':
    case 'waiting_for_human': {
      return pc.yellow(status);
    }
    case 'active': {
      return pc.cyan(status);
    }
    default: {
      return pc.dim(status);
    }
  }
};

/** One-line human summary of an outcome, used by the stream and poll paths. */
export const describeOutcome = (outcome: AgentRunOutcome): string => {
  switch (outcome.kind) {
    case 'completed': {
      return `${pc.green('✓')} Agent finished`;
    }
    case 'failed': {
      return `${pc.red('✗')} Agent failed${outcome.error ? `: ${outcome.error}` : ''}`;
    }
    case 'interrupted': {
      return `${pc.yellow('■')} Agent interrupted`;
    }
    case 'waiting_for_human': {
      return `${pc.yellow('⏸')} Agent paused: waiting for human approval — approve or answer it in LobeHub, the CLI does not wait for it`;
    }
    case 'unknown': {
      return `${pc.yellow('?')} Agent run outcome unknown${outcome.status ? ` (status: ${outcome.status})` : ''}`;
    }
  }
};

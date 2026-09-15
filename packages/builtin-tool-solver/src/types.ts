export const SolverIdentifier = 'builtin-solver';

export const SolverApiName = {
  solve: 'solve',
  verify: 'verify',
} as const;

export type SolverApiNameType = (typeof SolverApiName)[keyof typeof SolverApiName];

/**
 * Solver service contract (mirror of the deployed solver service).
 *
 * The service is intentionally generic over domain packs: every endpoint is
 * namespaced by `pack` and the spec/plan payloads are pack-defined JSON. The
 * shapes below type the envelope (status, conflicts, solverMeta, check
 * results) that every pack shares, plus the candidate fields the first pack
 * (`travelplanner`) emits.
 */

export type SolverStatus = 'optimal' | 'feasible_timeout' | 'infeasible' | 'error';

export interface SolverMeta {
  engine?: string;
  solveMs?: number;
  /** Effective per-request time limit after the server-side cap. */
  timeLimitMs?: number | null;
}

/**
 * One feasible plan. `plan` is the pack's plan JSON (for travelplanner: one
 * entry per day with current_city / transportation / meals / attraction /
 * accommodation). Cost fields are USD totals when the pack models cost.
 */
export interface SolverCandidate {
  costBreakdown?: Record<string, number>;
  plan: Record<string, any>[];
  totalCost?: number;
}

/** One infeasibility conflict, mapped back to spec fields for the repair loop. */
export interface SolverConflict {
  /** Constraint kind, e.g. "budget", "cuisine:Italian", "structural:accommodationDomain". */
  constraint: string;
  /** Human-readable reason; for budget conflicts it names the minimum feasible plan cost. */
  explanation: string;
  /** Spec field paths involved in the conflict (e.g. ["days", "visitingCityNumber"]). */
  involvedFields?: string[];
  /** Human-actionable repair hints derived from the conflict. */
  suggestedRelaxations?: string[];
}

/** Response envelope of POST /v1/packs/{pack}/solve. */
export interface SolveServiceResponse {
  candidates?: SolverCandidate[];
  conflicts?: SolverConflict[];
  /** Present when status === 'error' (spec validation failures, one per violation). */
  error?: string;
  solverMeta?: SolverMeta;
  status: SolverStatus;
}

export interface VerifyCheckResult {
  constraint: string;
  detail?: string;
  pass: boolean;
}

/** Response envelope of POST /v1/packs/{pack}/verify. */
export interface VerifyServiceResponse {
  pass: boolean;
  results: VerifyCheckResult[];
}

// ---- Tool API params / state ----

export interface SolveParams {
  /** Max candidate plans to return (server-capped, default 3). */
  maxCandidates?: number;
  /** Domain pack id, e.g. "travelplanner". */
  pack: string;
  /** Query id selecting the pack's reference data, e.g. "validation_0". */
  queryId: string;
  /** Pack-defined constraint spec extracted from the user's request. */
  spec: Record<string, any>;
  /** Solve time budget in ms (server-capped; effective value echoed in solverMeta). */
  timeLimitMs?: number;
}

export interface SolveState {
  candidates?: SolverCandidate[];
  conflicts?: SolverConflict[];
  error?: string;
  pack: string;
  queryId: string;
  solverMeta?: SolverMeta;
  status: SolverStatus;
}

export interface VerifyParams {
  pack: string;
  /** The candidate plan to check, exactly as returned by solve. */
  plan: Record<string, any>[];
  queryId: string;
  spec: Record<string, any>;
}

export interface VerifyState {
  pack: string;
  pass: boolean;
  passed: number;
  queryId: string;
  results: VerifyCheckResult[];
  total: number;
}

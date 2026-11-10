/**
 * Server-side guard against session-cumulative Claude Code cost.
 *
 * CC's `result.total_cost_usd` is the cost of the whole CLI session, and CC
 * restores the previous `cost-state` on `--resume`, so every resumed run of a
 * topic reports everything the session has spent so far. Current clients
 * subtract the previous session total before reporting (see
 * `packages/heterogeneous-agents/src/spawn/claudeCodeSessionCost.ts`), but older
 * `lh` CLI / desktop builds still send the cumulative value, and the server is
 * never told which client version produced a run. One such run then books the
 * session's whole history as its own spend, and the topic rollup sums every one
 * of them.
 *
 * So the decision is made from evidence on the rows themselves:
 *
 * - `cap` is the most a run could honestly cost for its tokens (about twice the
 *   most expensive list price). A value above it cannot be a per-run cost.
 * - A cumulative value continues the previous CC op's reported value: the
 *   difference is non-negative and itself within the cap.
 * - A previous op this guard already de-cumulated proves the session reports
 *   cumulatively, so its successors are treated the same even below the cap.
 *
 * New clients report per-run cost, which almost never satisfies both conditions
 * (it rarely exceeds the cap), so their values pass through untouched.
 */

export const CLAUDE_CODE_PROVIDER = 'claude-code';

/** USD per input token the cap allows (2x the most expensive list price). */
const CAP_INPUT_USD_PER_TOKEN = 10e-6;
/** USD per output token the cap allows (2x the most expensive list price). */
const CAP_OUTPUT_USD_PER_TOKEN = 50e-6;

/** The previous costed Claude Code op on the same topic. */
export interface PreviousClaudeCodeCost {
  /** Raw value that op's client reported: `cost.reportedSessionTotal` when the
   * guard rewrote it, otherwise its `total_cost`. */
  reportedCost: number;
  /** Whether the guard already treated that op as session-cumulative. */
  reportedCumulative: boolean;
}

export interface ClaudeCodeCostInput {
  inputTokens: number | null | undefined;
  outputTokens: number | null | undefined;
  previous: PreviousClaudeCodeCost | null | undefined;
  provider: string | null | undefined;
  /** Cost the client reported for the finishing op. */
  reportedCost: number;
}

export interface ClaudeCodeCostResolution {
  /** Set only when the reported cost was a session total; keeps the raw value so
   * the next op of the session can be compared against it. */
  reportedSessionTotal?: number;
  /** Cost to book for the op. */
  total: number;
}

/** Round to the `numeric(20, 6)` scale of `agent_operations.total_cost`. */
const roundUsd = (value: number) => Math.round(value * 1e6) / 1e6;

const tokens = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

export const claudeCodeRunCostCap = (
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
) =>
  tokens(inputTokens) * CAP_INPUT_USD_PER_TOKEN + tokens(outputTokens) * CAP_OUTPUT_USD_PER_TOKEN;

export const resolveClaudeCodeRunCost = ({
  inputTokens,
  outputTokens,
  previous,
  provider,
  reportedCost,
}: ClaudeCodeCostInput): ClaudeCodeCostResolution => {
  const untouched = { total: reportedCost };
  if (provider !== CLAUDE_CODE_PROVIDER || !previous) return untouched;
  if (!Number.isFinite(reportedCost) || !Number.isFinite(previous.reportedCost)) return untouched;

  const cap = claudeCodeRunCostCap(inputTokens, outputTokens);
  const delta = reportedCost - previous.reportedCost;
  // A session reset (or an unrelated session) reports less than the previous op.
  if (delta < 0 || delta > cap) return untouched;
  if (reportedCost <= cap && !previous.reportedCumulative) return untouched;

  return { reportedSessionTotal: reportedCost, total: roundUsd(delta) };
};

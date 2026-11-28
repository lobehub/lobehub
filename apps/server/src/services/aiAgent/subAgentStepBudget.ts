/**
 * Step budget for every sub-agent and group member run when the caller supplies
 * none. An unbounded child once ran thousands of steps while its parent waited
 * (lobehub#17284). Reaching the cap does not abort the
 * run: the runtime sets `forceFinish`, strips tools and asks the model for a
 * final answer, so the parent still receives the child's partial result.
 *
 * 100 steps is about 50 model calls (a tool round costs a second step). In
 * observed usage, threaded child runs had p90 ≈ 70 and p99 ≈ 250 steps, so the
 * cap only trims the slowest few percent of runs.
 */
export const DEFAULT_SUB_AGENT_MAX_STEPS = 100;

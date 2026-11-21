/**
 * Client-side completion bridge for parked sub-agent / group-member parents —
 * the mirror of the server's `completeSubAgentBridge` (AgentRuntimeService).
 *
 * Why this exists: when a client-executed child (a `callSubAgent` run or a
 * group-orchestration member) parks on human approval / an async tool, the
 * parent's tool call must NOT settle. The parent parks in
 * `waiting_for_async_tool` holding a deferred placeholder tool message, and
 * this bridge is what settles it later:
 *
 *   1. The child's run reaches a terminal state → `fireClientSubAgentBridge`
 *      is invoked at the run boundary (streamingExecutor).
 *   2. The bridge backfills the parent's placeholder tool message with the
 *      child's final output (so the parent conversation rebuilds with a real
 *      tool result).
 *   3. The bridge resumes the parked parent:
 *      - `sub-agent` kind: re-enters `executeClientAgent` from the tool
 *        message position (phase `tool_result`), the same re-entry shape the
 *        human-approval resume path uses.
 *      - `group-orchestration` kind: re-enters
 *        `internal_execGroupOrchestration` with the member's `task_completed`
 *        result as the initial result, so the supervisor sees the member's
 *        final answer and decides the next round.
 *
 * Registry keys are the CHILD's isolation threadId: the parked child resumes
 * out-of-band under a DIFFERENT operation (user approval / queued follow-up),
 * so an operation-id key would never fire — but every continuation of the
 * child runs in the same thread, whose terminal run boundary claims the
 * bridge. Claiming removes the entry (CAS single-fire): a later terminal run
 * in the same thread is a no-op, so an already-resumed parent's tool message
 * is never rewritten.
 *
 * Module map (split from a single file along its pipeline stages):
 * - `types.ts` — registration / outcome / persisted-coordinate shapes.
 * - `registry.ts` — registration + two-phase activation (arm) + the
 *   post-reload coordinate persistence.
 * - `backfill.ts` — shared placeholder backfill (content + plugin state) for
 *   the resume path and the parent-settled-out-of-band path.
 * - `fire.ts` — terminal-boundary fire: settlement, parent guards, barrier,
 *   resume / re-entry.
 */

export { fireClientSubAgentBridge } from './fire';
export { armClientSubAgentBridgesForContext } from './fire';
export {
  __clearRegistryForTests,
  __resetBridgeForTests,
  flushPendingBridgeCoordinates,
} from './registry';
export {
  registerClientSubAgentBridge,
  registerGroupBridgeFromParkExit,
  registerSubAgentBridgeFromSpawner,
} from './registry';
export type { ClientSubAgentBridgeRegistration, SubAgentBridgeOutcome } from './types';

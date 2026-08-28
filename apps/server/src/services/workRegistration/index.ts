/**
 * Work registration service — turns what an agent run produced into durable
 * Work rows (`works` / `work_versions`) and stamps the display anchor that
 * makes the cards render.
 *
 * - `registerWorksForOperation` — completion-time scan of a server operation
 *   tree: entity `file` Works (sandbox export pipeline) + the shell Work scan
 *   (gh CLI runs from codex / claude-code / device `lobe-local-system`).
 * - `registerShellWorksForLocalRun` — the same shell scan replayed for
 *   desktop-LOCAL hetero runs, which have no `agent_operations` row and are
 *   reported by the client executor instead.
 * - `stateHasEntityFileEdits` — pure per-step predicate over the in-memory
 *   runtime state, used to suppress the early `visible_output_end` when
 *   completion will export files.
 *
 * Execution-time registrations (skill structured tools, task / document
 * works) live with their owning features — see `WorkModel` and the agent-work
 * skill's file map.
 */
export {
  type LocalRunShellWorksResult,
  registerShellWorksForLocalRun,
} from './localRunWorkRegistration';
export {
  registerWorksForOperation,
  type RegisterWorksForOperationParams,
  type WorksRegistrationOutcome,
} from './registerWorksForOperation';
export { stateHasEntityFileEdits } from './stateHasEntityFileEdits';

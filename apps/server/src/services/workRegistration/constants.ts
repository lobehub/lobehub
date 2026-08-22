/**
 * Human-intervention statuses whose tool NEVER executed. `requestHumanApprove`
 * persists an EMPTY tool row (`content: ''`, no result state) with
 * `intervention.status='pending'` when it parks; a rejected/aborted approval
 * leaves that row unexecuted too (rejection writes only content text, no state
 * and no plugin error). The scanner's sandbox writeFile/editFile branch falls
 * back from a missing `state.path` to `arguments.path`, so without this filter
 * an unexecuted row would register — and export stale sandbox content for — a
 * file the user never approved writing. `approved` rows execute on resume and
 * carry a real result state, so they pass through. Shared by every record
 * collection that feeds the Work scans (operation-tree and local-run).
 */
export const UNEXECUTED_INTERVENTION_STATUSES = new Set(['pending', 'rejected', 'aborted']);

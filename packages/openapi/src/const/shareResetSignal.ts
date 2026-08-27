/**
 * Internal-only response header used to bridge `AgentController.updateAgent`
 * (this package) and the process that mounts this Hono app
 * (`src/app/(backend)/api/v1/[[...route]]/route.ts`) across the `fetch()`
 * boundary between them.
 *
 * WHY a header instead of a direct call: `packages/openapi` must not depend
 * on `apps/server` (`AiAgentService`, `after()` live there), so it cannot
 * schedule the post-commit Agent Share visitor-run interrupt itself when a
 * config write resets a `link` share back to `private`. The mounting file
 * DOES have `@/server/*` access, so it reads this header off the `Response`,
 * fires the interrupt, and strips the header before the response reaches the
 * API caller. Value shape: `"<ownerId>:<agentId>:<revocationGeneration>"` —
 * the third segment is the EXACT `agentShareGenerations` value the reset
 * transaction bumped to, threaded straight through to
 * `AiAgentService.interruptActiveShareRuns` (never re-read at header-parse
 * time — see that method's JSDoc for why).
 */
export const AGENT_SHARE_RESET_SIGNAL_HEADER = 'x-lobehub-agent-share-reset';

/**
 * Same cross-boundary bridge as {@link AGENT_SHARE_RESET_SIGNAL_HEADER}, used
 * by `AgentController.deleteAgent` instead: a `DELETE /api/v1/agents/:id`
 * cascades away the agent's share AND its visitor topics in the same
 * transaction, so by the time the mounting route file could re-query
 * `topics` for this agentId (the reset signal's approach) there is nothing
 * left to find — see `AgentModel.delete`'s JSDoc. The payload therefore
 * carries the pre-snapshotted run list itself (`ownerId` + every
 * `{ operationId, topicId }` still in flight at delete time) instead of just
 * an agentId, JSON-encoded since a header value cannot hold a structured
 * value directly. Stripped from the response before it reaches the API
 * caller — see `src/app/(backend)/api/v1/[[...route]]/route.ts`.
 */
export const AGENT_SHARE_DELETE_SIGNAL_HEADER = 'x-lobehub-agent-share-delete';

/** Payload shape carried by {@link AGENT_SHARE_DELETE_SIGNAL_HEADER}, JSON-encoded. */
export interface AgentShareDeleteSignal {
  activeShareRuns: Array<{ operationId: string; topicId: string }>;
  ownerId: string;
}

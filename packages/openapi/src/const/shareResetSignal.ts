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
 * API caller. Value shape: `"<ownerId>:<agentId>"`. See LOBE-11930 hole 2.
 */
export const AGENT_SHARE_RESET_SIGNAL_HEADER = 'x-lobehub-agent-share-reset';

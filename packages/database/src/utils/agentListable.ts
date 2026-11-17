import { type AnyColumn, isNull } from 'drizzle-orm';

import { agents } from '../schemas';

/**
 * A project's own coordinator (`agents.owner_project_id` set) is configured
 * through that project and reached from it, so every standalone agent listing
 * — sidebar, `/agents`, agent search, Cmd+K, label usage counts, recents,
 * `queryAgents` / `lh agent list` — leaves it out. The row is never deleted:
 * single-agent reads (`getAgentConfigById`, the chat runtime, project members)
 * do not apply this predicate, so the project's conversations, IM callbacks and
 * a direct `/agent/:aid` link keep working. Clearing the column (project
 * deleted, coordinator replaced) brings the agent back into the lists.
 *
 * Pass `column` when the agent row is reached through a subquery alias.
 */
export const isStandaloneAgent = (column: AnyColumn = agents.ownerProjectId) => isNull(column);

import { isGoalPrompt } from '@lobechat/builtin-tool-goal';

import type { HeteroOperationCapability } from '@/libs/trpc/utils/internalJwt';

/**
 * What a heterogeneous run's operation token may do.
 *
 * `goal:manage` lets the CLI create a goal the agent supervises from this
 * conversation (`lh goal create --conversation`), or bind an existing one to it
 * (`lh goal bind-topic`, which the `/goal` instructions route a named goal to). The token is exposed to the
 * always-installed CLI, so it is granted only when the user asked for a goal
 * with `/goal`: an ordinary coding run that meets instructions telling it to
 * run that command must not be able to launch persistent follow-on work.
 *
 * `acceptance:evidence` lets a Task run file evidence into its own verification
 * round (`lh acceptance run result submit|ingest --operation`). That round is
 * owned by the operation's creator, so on a device logged in as another member
 * the token is the only identity that can reach it. Only a Task run has a
 * round to file into.
 *
 * Renewal copies the minted claims, so a run never gains either later.
 */
export const heteroOperationCapabilities = (
  prompt: unknown,
  options: { taskId?: string } = {},
): HeteroOperationCapability[] => [
  'hetero:ingest',
  'hetero:finish',
  'hetero:intervention:read',
  ...(isGoalPrompt(prompt) ? (['goal:manage'] as const) : []),
  ...(options.taskId ? (['acceptance:evidence'] as const) : []),
];

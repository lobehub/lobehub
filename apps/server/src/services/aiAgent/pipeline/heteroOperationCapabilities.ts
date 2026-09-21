import { isGoalPrompt } from '@lobechat/builtin-tool-goal';

import type { HeteroOperationCapability } from '@/libs/trpc/utils/internalJwt';

/**
 * What a heterogeneous run's operation token may do.
 *
 * `goal:manage` lets the CLI create a goal the agent supervises from this
 * conversation (`lh goal create --conversation`). The token is exposed to the
 * always-installed CLI, so it is granted only when the user asked for a goal
 * with `/goal`: an ordinary coding run that meets instructions telling it to
 * run that command must not be able to launch persistent follow-on work.
 * Renewal copies the minted claims, so a run never gains it later.
 */
export const heteroOperationCapabilities = (prompt: unknown): HeteroOperationCapability[] => [
  'hetero:ingest',
  'hetero:finish',
  'hetero:intervention:read',
  ...(isGoalPrompt(prompt) ? (['goal:manage'] as const) : []),
];

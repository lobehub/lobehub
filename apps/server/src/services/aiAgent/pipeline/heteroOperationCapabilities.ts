import { isGoalPrompt } from '@lobechat/builtin-tool-goal';

import type { HeteroOperationCapability } from '@/libs/trpc/utils/internalJwt';

/**
 * What a heterogeneous run's operation token may do.
 *
 * `goal:manage` lets the CLI create a goal the agent supervises from this
 * conversation (`lh goal create --conversation`), or bind an existing one to it
 * (`lh goal bind-topic`, which the `/goal` instructions route a named goal to). The token is exposed to the
 * always-installed CLI, so it follows who started the run, not what it says:
 * a turn the user sent (a chat message, or one they scheduled) gets it however
 * they word the ask, since users say "run a goal" as often as they type `/goal`.
 * Runs the server starts on its own — Task runs, goal planning and supervision
 * turns, background-result deliveries, cron, inbox and SCM wakeups — and
 * Channel or bot messages, whose sender may not be the owner, get it only from
 * an explicit `/goal`. That keeps a goal from spawning goals of its own. A goal
 * a user-sent run creates binds to that user's topic, where its tray shows it.
 *
 * `channel:read` and `channel:message` let a Channel dispatch read its own conversation
 * (`lh channel history|message`) and message Agents in the requester's other Channels
 * (`lh channel list|send`), as the requester, never as the device owner.
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
  options: {
    channel?: boolean;
    taskId?: string;
    /** The run answers a message the user sent: a chat turn or one they scheduled. */
    userTurn?: boolean;
  } = {},
): HeteroOperationCapability[] => [
  'hetero:ingest',
  ...(options.channel ? (['channel:read', 'channel:message'] as const) : []),
  'hetero:finish',
  'hetero:intervention:read',
  ...(isGoalPrompt(prompt) || (options.userTurn && !options.channel && !options.taskId)
    ? (['goal:manage'] as const)
    : []),
  ...(options.taskId ? (['acceptance:evidence'] as const) : []),
];

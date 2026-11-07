import type { WorkRegistrationIntent } from '@lobechat/types';

/**
 * Per-tool-call hand-off for client (legacy, non-gateway) Work registration.
 *
 * The client tool-execution dispatch registers Works in three different places
 * that do NOT return a rich result object up to `call_tool`:
 * - task: the builtin executor registry (`invokeExecutor`) — returns the result
 *   object, but the intent is manifest-derived there;
 * - skill (linear / github): `lobehubSkillExecutor`, whose dispatch returns only
 *   the truncated content STRING;
 * - document: the agent-documents runtime, whose registration used to be a
 *   server-side side-effect of the lambda mutation.
 *
 * None of these can ride the intent back on the tool result (string results,
 * side-effect registration), so each stashes a {@link WorkRegistrationIntent}
 * keyed by `toolCallId` while executing, and `call_tool` drains it AFTER the
 * tool's cumulative cost is known — writing the Work version ONCE with its
 * `cumulativeCost` instead of registering cost-less then back-filling.
 *
 * Keyed by `toolCallId` (unique per call) so concurrent batch tool calls never
 * collide. `take` deletes on read; `call_tool` drains the entry immediately
 * after the tool returns — before any aborted/no-result early-return — so an
 * entry is always freed even when the call is cancelled and never registered.
 */
const pendingWorkIntents = new Map<string, WorkRegistrationIntent>();

export const stashWorkIntent = (
  toolCallId: string | undefined,
  intent: WorkRegistrationIntent,
): void => {
  if (!toolCallId) return;
  pendingWorkIntents.set(toolCallId, intent);
};

export const takeWorkIntent = (
  toolCallId: string | undefined,
): WorkRegistrationIntent | undefined => {
  if (!toolCallId) return undefined;
  const intent = pendingWorkIntents.get(toolCallId);
  if (intent) pendingWorkIntents.delete(toolCallId);
  return intent;
};

import type { FieldSchema } from './types';

export const displayToolCallsField: FieldSchema = {
  key: 'displayToolCalls',
  default: true,
  description: 'channel.displayToolCallsHint',
  label: 'channel.displayToolCalls',
  type: 'boolean',
};

export const serverIdField: FieldSchema = {
  key: 'serverId',
  description: 'channel.serverIdHint',
  label: 'channel.serverId',
  type: 'string',
};

export const userIdField: FieldSchema = {
  key: 'userId',
  description: 'channel.userIdHint',
  label: 'channel.userId',
  type: 'string',
};

// ---------- Step-aware reactions ----------

/**
 * Emoji shown on the user's message the moment the bot acknowledges it —
 * before the LLM has produced its first step. Cross-platform safe: accepted
 * by the Telegram Bot API's strict reaction allowlist plus Discord/Slack.
 */
export const RECEIVED_REACTION_EMOJI = '👀';

/**
 * Emoji shown on the user's message while the agent is reasoning/generating
 * (step_type=call_llm). Swapped in on the first step callback, replacing the
 * "received" emoji.
 */
export const THINKING_REACTION_EMOJI = '🤔';

/**
 * Emoji shown on the user's message while a tool call is executing
 * (step_type=call_tool with non-empty toolsCalling). `⚡` is used instead of
 * the more literal `🛠️` because Telegram rejects `🛠️` from its reaction
 * allowlist.
 */
export const WORKING_REACTION_EMOJI = '⚡';

/**
 * Given an `afterStep` event payload, predict the emoji to display while the
 * NEXT step is running. `afterStep` fires post-completion, so `stepType`
 * describes what just happened — we swap the reaction to match what's
 * coming:
 *
 * - `call_llm` that returned pending `toolsCalling` → the runtime is about
 *   to execute those tools → "working" emoji.
 * - `call_tool` → the runtime will feed results back into the LLM →
 *   "thinking" emoji.
 * - `call_llm` without tools → the final response is ready; `onComplete`
 *   clears immediately after, "thinking" is a sensible neutral for the
 *   brief window.
 *
 * The "received" emoji is set separately by the bridge on webhook arrival
 * and is not returned here.
 */
export function getStepReactionEmoji(stepType: string | undefined, toolsCalling: unknown): string {
  const toolsAboutToRun =
    stepType === 'call_llm' && Array.isArray(toolsCalling) && toolsCalling.length > 0;
  return toolsAboutToRun ? WORKING_REACTION_EMOJI : THINKING_REACTION_EMOJI;
}

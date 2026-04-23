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
 * Resolve the reaction emoji to display for a given step-callback payload.
 * The "received" emoji is applied separately by the bridge when it first
 * sees a mention; this helper only ever returns thinking / working.
 */
export function getStepReactionEmoji(stepType: string | undefined, toolsCalling: unknown): string {
  const isToolCall =
    stepType === 'call_tool' && Array.isArray(toolsCalling) && toolsCalling.length > 0;
  return isToolCall ? WORKING_REACTION_EMOJI : THINKING_REACTION_EMOJI;
}

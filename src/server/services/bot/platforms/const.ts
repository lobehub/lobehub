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

// ---------- DM (Direct Message) strategy ----------

export type DmPolicy = 'open' | 'allowlist' | 'disabled';

export interface DmSettings {
  allowFrom: string[];
  policy: DmPolicy;
}

/**
 * Build a platform-specific DM settings group. A single `policy` enum decides
 * everything: `disabled` ignores DMs entirely, `open` accepts any sender, and
 * `allowlist` reveals an `allowFrom` input that whitelists specific user IDs.
 * Discord defaults to `disabled` (opt-in); Slack/Telegram/Feishu/QQ default
 * to `open` (opt-out).
 */
export function makeDmField(defaults: { policy: DmPolicy }): FieldSchema {
  return {
    key: 'dm',
    label: 'channel.dm',
    properties: [
      {
        key: 'policy',
        default: defaults.policy,
        description: 'channel.dmPolicyHint',
        enum: ['open', 'allowlist', 'disabled'],
        enumLabels: [
          'channel.dmPolicyOpen',
          'channel.dmPolicyAllowlist',
          'channel.dmPolicyDisabled',
        ],
        label: 'channel.dmPolicy',
        type: 'string',
      },
      {
        key: 'allowFrom',
        default: '',
        description: 'channel.dmAllowFromHint',
        label: 'channel.dmAllowFrom',
        placeholder: 'user_id_1, user_id_2',
        type: 'string',
        visibleWhen: { field: 'policy', value: 'allowlist' },
      },
    ],
    type: 'object',
  };
}

const DM_POLICIES: ReadonlySet<DmPolicy> = new Set(['open', 'allowlist', 'disabled']);

/**
 * Parse `settings.dm` into the runtime DmSettings shape. Callers always pass
 * settings that have been through `mergeWithDefaults`, so `dm.policy` is
 * present in production. The `'open'` fallback only kicks in if a value
 * outside the enum somehow makes it in.
 *
 * `allowFrom` is stored as a comma / newline / whitespace-separated string
 * in the UI; we split it here so the hot path in the router is a set lookup.
 */
export function extractDmSettings(
  settings: Record<string, unknown> | null | undefined,
): DmSettings {
  const dm = (settings?.dm ?? {}) as Record<string, unknown>;
  const rawPolicy = dm.policy as string | undefined;
  const policy: DmPolicy = DM_POLICIES.has(rawPolicy as DmPolicy)
    ? (rawPolicy as DmPolicy)
    : 'open';

  const rawAllowFrom = dm.allowFrom;
  const allowFrom: string[] =
    typeof rawAllowFrom === 'string'
      ? rawAllowFrom
          .split(/[\s,]+/)
          .map((id) => id.trim())
          .filter(Boolean)
      : Array.isArray(rawAllowFrom)
        ? rawAllowFrom
            .map(String)
            .map((id) => id.trim())
            .filter(Boolean)
        : [];

  return { allowFrom, policy };
}

/**
 * Gate inbound DM handling against the user-configured policy.
 *
 * - Non-DM threads short-circuit to `true`: DM policy never blocks @mentions
 *   in public channels / groups — those are governed by the mention logic.
 * - `policy='disabled'` → block all DMs.
 * - `policy='open'` → allow any sender.
 * - `policy='allowlist'` → allow only senders whose platform user ID is in
 *   the configured list. A missing `authorUserId` fails closed.
 */
export function shouldHandleDm(params: {
  authorUserId: string | undefined;
  dmSettings: DmSettings;
  isDM: boolean;
}): boolean {
  const { authorUserId, dmSettings, isDM } = params;
  if (!isDM) return true;
  if (dmSettings.policy === 'disabled') return false;
  if (dmSettings.policy === 'open') return true;
  // allowlist
  if (!authorUserId) return false;
  return dmSettings.allowFrom.includes(authorUserId);
}

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

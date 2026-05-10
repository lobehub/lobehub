import type { ChatTopicBotContext } from '@lobechat/types';

/**
 * Decision path produced by `resolveDeviceAccessPolicy`. Carried through to
 * `AgentToolsEngine` and the device-tool audit log so an operator can trace
 * which branch granted or denied access for a given turn.
 */
export type DeviceAccessReason =
  /** Non-bot caller (web / desktop / mobile UI). */
  | 'first-party'
  /** Bot caller, sender matches the configured owner platform ID. */
  | 'bot-owner'
  /**
   * Bot caller on a platform whose LobeHub integration is structurally
   * personal-scope (no group chat surfaced, no `settings.userId` to gate
   * on). See `PERSONAL_SCOPE_BOT_PLATFORMS` below.
   */
  | 'bot-personal-platform'
  /**
   * Bot caller, sender is on the operator's trusted external list. Reserved —
   * the resolver never returns this value yet; future work will plumb the
   * trusted list through `DeviceAccessPolicyInput` and add the branch here
   * without touching `AgentToolsEngine`.
   */
  | 'bot-trusted'
  /** Bot caller, sender is identifiable but not the owner — DENY device tools. */
  | 'bot-external-sender'
  /**
   * Bot caller but `senderExternalUserId` is missing (e.g. the platform's
   * webhook didn't deliver the author). Treated as untrusted external —
   * fail-closed.
   */
  | 'bot-owner-not-configured';

/**
 * Bot platforms whose LobeHub integration is **personal-scope-only at the
 * integration layer**. Two conditions must hold to qualify:
 *
 *   1. The platform's chat-adapter encodes every inbound thread as 1:1
 *      (no group / channel handling), so the "external user @s the bot in
 *      a group" attack surface from LOBE-8715 doesn't exist on this
 *      platform today.
 *   2. The platform's settings schema has no `userId` field, so an owner
 *      ID can't be configured even if we wanted to gate on it.
 *
 * For these platforms we treat the sender as trusted because there is no
 * group-chat fan-out path — every message is a direct conversation with
 * the bound account. The trade-off: messages from contacts of the bound
 * account also flow through; that's the accepted personal-scope risk.
 *
 * **Add a platform here only when both conditions hold.** Platforms that
 * support groups but lack a `userId` field (e.g. LINE today) MUST stay out
 * of this set — fix the schema first.
 */
const PERSONAL_SCOPE_BOT_PLATFORMS = new Set<string>(['wechat']);

export interface DeviceAccessPolicyInput {
  /** Undefined when the caller is a first-party UI (web / desktop / mobile). */
  botContext?: ChatTopicBotContext;
}

export interface DeviceAccessPolicyOutput {
  canUseDevice: boolean;
  reason: DeviceAccessReason;
}

/**
 * Decide whether device tools (`local-system`, `remote-device`) can be used
 * for the current turn. Pure function — the only authoritative place that
 * answers "is this caller allowed to touch the bot owner's machine?".
 *
 * Downstream consumers (`AgentToolsEngine` enable gates, `RemoteDeviceManifest`
 * system-prompt injection, audit log) read `canUseDevice` only — they MUST
 * NOT re-derive the answer from `botContext` themselves, so adding new rules
 * (trusted external list, channel policy, scope tiers) only changes this
 * resolver.
 */
export const resolveDeviceAccessPolicy = (
  input: DeviceAccessPolicyInput,
): DeviceAccessPolicyOutput => {
  const { botContext } = input;

  if (!botContext) {
    return { canUseDevice: true, reason: 'first-party' };
  }

  if (botContext.isOwner) {
    return { canUseDevice: true, reason: 'bot-owner' };
  }

  // Personal-scope platform check sits AFTER `isOwner` so that, if a future
  // schema for one of these platforms adds a `userId` field, the more
  // specific `bot-owner` decision still wins. While the field is absent
  // (current state for WeChat), this branch is the one that actually fires.
  if (PERSONAL_SCOPE_BOT_PLATFORMS.has(botContext.platform)) {
    return { canUseDevice: true, reason: 'bot-personal-platform' };
  }

  // Future: bot-trusted branch (operator-curated allowlist of external
  // senders). Falls through to the deny branch until the trusted list is
  // wired into `DeviceAccessPolicyInput`.

  if (!botContext.senderExternalUserId) {
    return { canUseDevice: false, reason: 'bot-owner-not-configured' };
  }

  return { canUseDevice: false, reason: 'bot-external-sender' };
};

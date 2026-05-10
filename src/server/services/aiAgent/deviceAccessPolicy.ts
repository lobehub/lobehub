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

  // Future: bot-trusted branch (operator-curated allowlist of external
  // senders). Falls through to the deny branch until the trusted list is
  // wired into `DeviceAccessPolicyInput`.

  if (!botContext.senderExternalUserId) {
    return { canUseDevice: false, reason: 'bot-owner-not-configured' };
  }

  return { canUseDevice: false, reason: 'bot-external-sender' };
};

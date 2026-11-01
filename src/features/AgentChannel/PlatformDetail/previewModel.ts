/**
 * What the Quick view shows is decided here, away from the component: given the
 * values currently in the form, what does the bot do for a message in a group,
 * and for one in a DM? The rules follow the runtime's access gate
 * (`shouldAllowSender`, `shouldHandleDm`, `shouldHandleGroup` and the router's
 * `passGatesOrNotify`); the wording is the component's job.
 */

export type PreviewScene = 'dm' | 'group';

export interface PreviewSettings {
  allowFrom?: unknown;
  dmPolicy?: string;
  groupAllowFrom?: unknown;
  groupPolicy?: string;
  watchKeywords?: unknown;
}

export interface PreviewOutcome {
  kind: 'answer' | 'notice';
  /** The bot's own system reply, under `channel.quickView.` */
  noticeKey?:
    | 'dm.allowlist'
    | 'dm.disabled'
    | 'dm.pairing'
    | 'group.allowlist'
    | 'group.disabled'
    | 'sender.rejected';
  /** A one-line caveat shown under an answer. */
  scopeNote?: 'groupAllowlist';
}

const hasEntries = (value: unknown) => Array.isArray(value) && value.length > 0;

/**
 * The preview's sender is someone who is neither on the list nor the bot's
 * owner (the owner passes every gate), so the rules read as a stranger meets
 * them. The order is the router's: the global list first, then the scope's
 * own policy. Every refusal is a real reply posted in the chat, never silence.
 */
export const resolveGroupOutcome = (settings: PreviewSettings): PreviewOutcome => {
  if (hasEntries(settings.allowFrom)) return { kind: 'notice', noticeKey: 'sender.rejected' };

  switch (settings.groupPolicy) {
    case 'disabled': {
      return { kind: 'notice', noticeKey: 'group.disabled' };
    }
    case 'allowlist': {
      // An empty list fails closed: the bot is enabled in no group.
      return hasEntries(settings.groupAllowFrom)
        ? { kind: 'answer', scopeNote: 'groupAllowlist' }
        : { kind: 'notice', noticeKey: 'group.allowlist' };
    }
    default: {
      return { kind: 'answer' };
    }
  }
};

export const resolveDmOutcome = (settings: PreviewSettings): PreviewOutcome => {
  // Pairing is the one policy that skips the global list, so a stranger can
  // reach a pairing code instead of being turned away first.
  if (settings.dmPolicy === 'pairing') return { kind: 'notice', noticeKey: 'dm.pairing' };
  if (hasEntries(settings.allowFrom)) return { kind: 'notice', noticeKey: 'dm.allowlist' };

  switch (settings.dmPolicy) {
    case 'allowlist': {
      return { kind: 'notice', noticeKey: 'dm.allowlist' };
    }
    case 'disabled': {
      return { kind: 'notice', noticeKey: 'dm.disabled' };
    }
    default: {
      return { kind: 'answer' };
    }
  }
};

/** Group is always there; the DM scene only exists for platforms with a DM policy. */
export const resolveScenes = (settingKeys: string[]): PreviewScene[] =>
  settingKeys.includes('dmPolicy') ? ['group', 'dm'] : ['group'];

/** Up to three watch keywords, trimmed and without empty rows. */
export const pickKeywords = (watchKeywords: unknown, limit = 3): string[] => {
  if (!Array.isArray(watchKeywords)) return [];

  return watchKeywords
    .map((entry) =>
      entry && typeof entry === 'object'
        ? String((entry as { keyword?: unknown }).keyword ?? '')
        : '',
    )
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, limit);
};

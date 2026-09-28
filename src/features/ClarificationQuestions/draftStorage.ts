import type { AskUserDraft } from '@lobechat/shared-tool-ui/ask-user';

const KEY_PREFIX = 'lobechat:clarification:draft:v1:';

/**
 * Unsent answers outlive the form: collapsing the island, leaving the page or
 * reloading unmounts it, and the user should find what they picked still
 * picked. Local storage, keyed by the round the answers belong to.
 */
export const readClarificationDraft = (key: string): AskUserDraft | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + key);
    return raw ? (JSON.parse(raw) as AskUserDraft) : undefined;
  } catch {
    return undefined;
  }
};

export const writeClarificationDraft = (key: string, draft: AskUserDraft): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY_PREFIX + key, JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the draft still lives in the form for now.
  }
};

export const clearClarificationDraft = (key: string): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY_PREFIX + key);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
};

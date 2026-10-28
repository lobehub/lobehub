/**
 * Heuristic guard for the secure secret form: catches values that look like
 * prose (a pasted sentence, a chat message) rather than a secret token, so a
 * wrong paste — the exact failure seen in T-967, where the previous chat
 * message was pasted into the form — asks for confirmation instead of being
 * saved silently.
 *
 * A value counts as prose when it contains CJK characters, Kana or Hangul
 * (secrets are ASCII tokens; every real-world key format is) or when it is a
 * long whitespace-separated sentence. Values with no whitespace and no CJK
 * pass unconfirmed — that covers API keys, JWTs, tokens, base64 blobs.
 */
export const detectProseValue = (value: string): boolean => {
  if (!value) return false;

  // Kana, CJK Unified Ideographs + extensions, Hangul, Compatibility Ideographs.
  if (/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/.test(value)) {
    return true;
  }

  // A long sentence pasted from chat: multiple space-separated words.
  const words = value.trim().split(/\s+/);
  return words.length >= 4 && value.trim().length >= 16;
};

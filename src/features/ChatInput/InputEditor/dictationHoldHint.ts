// Full-width punctuation already carries its own trailing space, so a hint that
// follows it must not add another gap on top.
const FULL_WIDTH_TERMINAL = /[、。！，：；？…]$/;

export const DICTATION_HOLD_HINT_GAP = 8;

export const getDictationHoldHintGap = (leadingText: string) =>
  FULL_WIDTH_TERMINAL.test(leadingText.trimEnd()) ? 0 : DICTATION_HOLD_HINT_GAP;

import { describe, expect, it } from 'vitest';

import { DICTATION_HOLD_HINT_GAP, getDictationHoldHintGap } from './dictationHoldHint';

describe('getDictationHoldHintGap', () => {
  it('adds no gap after full-width punctuation, which already spaces itself', () => {
    expect(getDictationHoldHintGap('使用 @ 分配任务给其他智能体。')).toBe(0);
    expect(getDictationHoldHintGap('继续跟进。 ')).toBe(0);
    expect(getDictationHoldHintGap('从任何想法开始…')).toBe(0);
  });

  it('keeps the gap after half-width punctuation or plain text', () => {
    expect(getDictationHoldHintGap('@ to assign tasks to other agents.')).toBe(
      DICTATION_HOLD_HINT_GAP,
    );
    expect(getDictationHoldHintGap('描述任务或向 Claude Code 提问')).toBe(DICTATION_HOLD_HINT_GAP);
    expect(getDictationHoldHintGap('')).toBe(DICTATION_HOLD_HINT_GAP);
  });
});

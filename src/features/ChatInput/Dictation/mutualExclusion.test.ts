import { describe, expect, it } from 'vitest';

import { isOtherAudioInputModeActive } from './mutualExclusion';

describe('audio input mutual exclusion', () => {
  it('blocks dictation while a voice message is active', () => {
    expect(isOtherAudioInputModeActive('voiceMessage', 'dictation')).toBe(true);
  });

  it('blocks voice messages while dictation is active', () => {
    expect(isOtherAudioInputModeActive('dictation', 'voiceMessage')).toBe(true);
  });

  it('allows an idle or same-mode control', () => {
    expect(isOtherAudioInputModeActive(undefined, 'dictation')).toBe(false);
    expect(isOtherAudioInputModeActive('dictation', 'dictation')).toBe(false);
  });
});

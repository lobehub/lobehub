import { describe, expect, it } from 'vitest';

import { getStepReactionEmoji, THINKING_REACTION_EMOJI, WORKING_REACTION_EMOJI } from '../const';

describe('getStepReactionEmoji', () => {
  it('returns thinking emoji for call_llm', () => {
    expect(getStepReactionEmoji('call_llm', [])).toBe(THINKING_REACTION_EMOJI);
  });

  it('returns thinking emoji for call_tool without any toolsCalling', () => {
    // Tool step with an empty call list still counts as "about to think again".
    expect(getStepReactionEmoji('call_tool', [])).toBe(THINKING_REACTION_EMOJI);
    expect(getStepReactionEmoji('call_tool', undefined)).toBe(THINKING_REACTION_EMOJI);
  });

  it('returns working emoji for call_tool with pending toolsCalling', () => {
    expect(getStepReactionEmoji('call_tool', [{ name: 'search' }])).toBe(WORKING_REACTION_EMOJI);
  });

  it('returns thinking emoji when step type is missing', () => {
    expect(getStepReactionEmoji(undefined, undefined)).toBe(THINKING_REACTION_EMOJI);
  });
});

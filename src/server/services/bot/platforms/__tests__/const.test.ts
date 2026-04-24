import { describe, expect, it } from 'vitest';

import { getStepReactionEmoji, THINKING_REACTION_EMOJI, WORKING_REACTION_EMOJI } from '../const';

describe('getStepReactionEmoji', () => {
  it('returns working emoji after call_llm that queued pending tool calls (tools about to run)', () => {
    expect(getStepReactionEmoji('call_llm', [{ name: 'search' }])).toBe(WORKING_REACTION_EMOJI);
  });

  it('returns thinking emoji after call_llm with no tools (terminal LLM / about to finish)', () => {
    expect(getStepReactionEmoji('call_llm', [])).toBe(THINKING_REACTION_EMOJI);
    expect(getStepReactionEmoji('call_llm', undefined)).toBe(THINKING_REACTION_EMOJI);
  });

  it('returns thinking emoji after call_tool (LLM about to resume with tool results)', () => {
    expect(getStepReactionEmoji('call_tool', [{ name: 'search' }])).toBe(THINKING_REACTION_EMOJI);
    expect(getStepReactionEmoji('call_tool', [])).toBe(THINKING_REACTION_EMOJI);
  });

  it('returns thinking emoji when step type is missing', () => {
    expect(getStepReactionEmoji(undefined, undefined)).toBe(THINKING_REACTION_EMOJI);
  });
});

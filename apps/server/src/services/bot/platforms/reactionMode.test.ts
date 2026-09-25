import { describe, expect, it } from 'vitest';

import {
  BOT_REACTION_MODES,
  DEFAULT_BOT_REACTION_MODE,
  normalizeBotReactionMode,
  reactionModeField,
  shouldApplyReaction,
} from './const';

describe('normalizeBotReactionMode', () => {
  it('passes known modes through', () => {
    for (const mode of BOT_REACTION_MODES) {
      expect(normalizeBotReactionMode(mode)).toBe(mode);
    }
  });

  it('falls back to the default for rows saved before the field existed', () => {
    expect(normalizeBotReactionMode(undefined)).toBe(DEFAULT_BOT_REACTION_MODE);
    expect(normalizeBotReactionMode(null)).toBe(DEFAULT_BOT_REACTION_MODE);
  });

  it('falls back to the default for unknown values instead of disabling reactions', () => {
    expect(normalizeBotReactionMode('verbose')).toBe(DEFAULT_BOT_REACTION_MODE);
    expect(normalizeBotReactionMode(true)).toBe(DEFAULT_BOT_REACTION_MODE);
  });
});

describe('shouldApplyReaction', () => {
  it('never touches reactions under `none`', () => {
    expect(shouldApplyReaction('none', 'received')).toBe(false);
    expect(shouldApplyReaction('none', 'thinking')).toBe(false);
    expect(shouldApplyReaction('none', 'step')).toBe(false);
    expect(shouldApplyReaction('none', 'clear')).toBe(false);
  });

  it('skips only per-step swaps under `minimal`', () => {
    expect(shouldApplyReaction('minimal', 'received')).toBe(true);
    expect(shouldApplyReaction('minimal', 'thinking')).toBe(true);
    expect(shouldApplyReaction('minimal', 'step')).toBe(false);
    expect(shouldApplyReaction('minimal', 'clear')).toBe(true);
  });

  it('allows every phase under `full`', () => {
    expect(shouldApplyReaction('full', 'received')).toBe(true);
    expect(shouldApplyReaction('full', 'thinking')).toBe(true);
    expect(shouldApplyReaction('full', 'step')).toBe(true);
    expect(shouldApplyReaction('full', 'clear')).toBe(true);
  });
});

describe('reactionModeField', () => {
  it('defaults to minimal and lists every mode with matching labels', () => {
    expect(reactionModeField.default).toBe(DEFAULT_BOT_REACTION_MODE);
    expect(reactionModeField.enum).toEqual([...BOT_REACTION_MODES]);
    expect(reactionModeField.enumLabels).toHaveLength(BOT_REACTION_MODES.length);
    expect(reactionModeField.enumDescriptions).toHaveLength(BOT_REACTION_MODES.length);
  });
});

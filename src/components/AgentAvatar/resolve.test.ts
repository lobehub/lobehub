import { DEFAULT_AVATAR } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import {
  customAgentAvatar,
  isDefaultAgentAvatar,
  isGeneratedAgentAvatar,
  parseGeneratedAgentAvatar,
  pickDomProps,
  resolveAgentAvatar,
  toGeneratedAgentAvatar,
} from './resolve';

describe('isDefaultAgentAvatar', () => {
  it('treats empty values and the legacy default image as no avatar', () => {
    expect(isDefaultAgentAvatar(undefined)).toBe(true);
    expect(isDefaultAgentAvatar(null)).toBe(true);
    expect(isDefaultAgentAvatar('')).toBe(true);
    expect(isDefaultAgentAvatar(DEFAULT_AVATAR)).toBe(true);
  });

  it('keeps an emoji or image the agent set', () => {
    expect(isDefaultAgentAvatar('🤖')).toBe(false);
    expect(isDefaultAgentAvatar('https://example.com/a.png')).toBe(false);
  });

  // Picking a character is an avatar of the agent's own: deleting it is what
  // brings back the default one.
  it('does not count a picked character as no avatar', () => {
    expect(isDefaultAgentAvatar('generated:character-1')).toBe(false);
  });
});

describe('generated agent avatar values', () => {
  it('round-trips the seed of a picked character', () => {
    expect(toGeneratedAgentAvatar('character-1')).toBe('generated:character-1');
    expect(parseGeneratedAgentAvatar(toGeneratedAgentAvatar('character-1'))).toBe('character-1');
  });

  it('reads no seed from emoji, images, empty values or an empty pick', () => {
    expect(parseGeneratedAgentAvatar('🤖')).toBeUndefined();
    expect(parseGeneratedAgentAvatar('https://example.com/generated:a.png')).toBeUndefined();
    expect(parseGeneratedAgentAvatar(null)).toBeUndefined();
    expect(parseGeneratedAgentAvatar('generated:')).toBeUndefined();
    expect(parseGeneratedAgentAvatar('generated:  ')).toBeUndefined();
    expect(parseGeneratedAgentAvatar({ type: 'span' })).toBeUndefined();
  });

  it('treats empty values and picked characters as drawn, emoji and images as not', () => {
    expect(isGeneratedAgentAvatar(undefined)).toBe(true);
    expect(isGeneratedAgentAvatar(DEFAULT_AVATAR)).toBe(true);
    expect(isGeneratedAgentAvatar('generated:character-1')).toBe(true);
    expect(isGeneratedAgentAvatar('🤖')).toBe(false);
    expect(isGeneratedAgentAvatar('https://example.com/a.png')).toBe(false);
  });

  it('hands out only emoji and images as a custom avatar', () => {
    expect(customAgentAvatar('generated:character-1')).toBeUndefined();
    expect(customAgentAvatar(DEFAULT_AVATAR)).toBeUndefined();
    expect(customAgentAvatar('🤖')).toBe('🤖');
  });
});

describe('resolveAgentAvatar', () => {
  it('draws the generated character instead of the legacy default image', () => {
    expect(
      resolveAgentAvatar({ agentId: 'agt_1', avatar: DEFAULT_AVATAR, name: 'Researcher' }),
    ).toEqual({ kind: 'generated', label: 'Researcher', seed: 'agt_1' });
  });

  it('seeds by agent id, so a rename keeps the same character', () => {
    const before = resolveAgentAvatar({ agentId: 'agt_1', name: 'Before' });
    const after = resolveAgentAvatar({ agentId: 'agt_1', name: 'After' });

    expect(before.seed).toBe(after.seed);
  });

  it('falls back to the name, then the title, when there is no id', () => {
    expect(resolveAgentAvatar({ name: 'Writer', title: 'Tooltip' }).seed).toBe('Writer');
    expect(resolveAgentAvatar({ title: 'Tooltip' }).seed).toBe('Tooltip');
  });

  it('draws the picked character over the agent id', () => {
    expect(
      resolveAgentAvatar({ agentId: 'agt_1', avatar: 'generated:character-1', name: 'Bot' }),
    ).toEqual({ kind: 'generated', label: 'Bot', seed: 'character-1' });
  });

  it('gives two agents that picked the same character the same seed', () => {
    const first = resolveAgentAvatar({ agentId: 'agt_1', avatar: 'generated:character-1' });
    const second = resolveAgentAvatar({ agentId: 'agt_2', avatar: 'generated:character-1' });

    expect(first.seed).toBe(second.seed);
  });

  it('falls back to the agent id once the pick is removed or empty', () => {
    expect(resolveAgentAvatar({ agentId: 'agt_1', avatar: null }).seed).toBe('agt_1');
    expect(resolveAgentAvatar({ agentId: 'agt_1', avatar: 'generated:' })).toEqual({
      kind: 'generated',
      label: undefined,
      seed: 'agt_1',
    });
  });

  it('keeps a custom avatar', () => {
    expect(resolveAgentAvatar({ agentId: 'agt_1', avatar: '🤖', name: 'Bot' })).toEqual({
      avatar: '🤖',
      kind: 'custom',
      label: 'Bot',
      seed: 'agt_1',
    });
  });
});

describe('pickDomProps', () => {
  // A Popover/Tooltip trigger injects handlers into its child; the generated
  // branch used to drop them, so hovering an author without an avatar never
  // opened their profile popup.
  it('keeps the handlers and attributes a trigger injects', () => {
    const onMouseEnter = () => {};
    const onFocus = () => {};

    expect(
      pickDomProps({
        'aria-expanded': false,
        'data-state': 'closed',
        'id': 'trigger',
        onFocus,
        onMouseEnter,
        'role': 'button',
        'tabIndex': 0,
      }),
    ).toEqual({
      'aria-expanded': false,
      'data-state': 'closed',
      'id': 'trigger',
      onFocus,
      onMouseEnter,
      'role': 'button',
      'tabIndex': 0,
    });
  });

  it('drops avatar-only props that do not belong on a DOM element', () => {
    expect(
      pickDomProps({
        animation: true,
        emojiScaleWithBackground: true,
        unoptimized: true,
        variant: 'outlined',
      }),
    ).toEqual({});
  });
});

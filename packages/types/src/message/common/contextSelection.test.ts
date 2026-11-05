import { describe, expect, it } from 'vitest';

import { ContextSelectionSchema } from './contextSelection';

describe('ContextSelectionSchema', () => {
  it('accepts a mini game snapshot', () => {
    const selection = {
      content: '<game_state scene="pixel-yard"/>',
      format: 'xml',
      id: 'game:pixel-yard',
      sceneId: 'pixel-yard',
      source: 'game',
      title: 'Pixel Yard',
    };
    expect(ContextSelectionSchema.parse(selection)).toEqual(selection);
  });

  it('rejects a game snapshot without its scene id', () => {
    expect(
      ContextSelectionSchema.safeParse({ content: '', id: 'game', source: 'game' }).success,
    ).toBe(false);
  });
});

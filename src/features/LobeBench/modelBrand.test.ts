import { describe, expect, it } from 'vitest';

import { adaptBrandColor, findBrandColor } from '@/features/LobeBench/modelBrand';

const mappings = [
  { Icon: { colorPrimary: '#000' }, keywords: ['gpt-6', 'gpt-5'] },
  { Icon: { colorPrimary: '#4D6BFE' }, keywords: ['deepseek'] },
  { Icon: {}, keywords: ['mimo'] },
];

describe('findBrandColor', () => {
  it('matches the first mapping whose keyword pattern appears in the model id', () => {
    expect(findBrandColor(mappings, 'openrouter/deepseek/deepseek-v4.1-flash')).toBe('#4D6BFE');
    expect(findBrandColor(mappings, 'GPT-6.1-sol')).toBe('#000');
  });

  it('returns nothing for unknown models, brands without a color, or no catalog yet', () => {
    expect(findBrandColor(mappings, 'kimi-k2.6')).toBeUndefined();
    expect(findBrandColor(mappings, 'mimo-v2.6-flash')).toBeUndefined();
    expect(findBrandColor(undefined, 'deepseek-v4.1-flash')).toBeUndefined();
    expect(findBrandColor(mappings, undefined)).toBeUndefined();
  });
});

describe('adaptBrandColor', () => {
  it('flips near-black and near-white brands to the theme ink and keeps the rest', () => {
    expect(adaptBrandColor('#000', false)).toBe('#000000');
    expect(adaptBrandColor('#000', true)).toBe('#ffffff');
    expect(adaptBrandColor('#FFFFFF', false)).toBe('#000000');
    expect(adaptBrandColor('#4D6BFE', true)).toBe('#4D6BFE');
  });
});

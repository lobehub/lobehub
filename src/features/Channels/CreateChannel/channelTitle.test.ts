import { describe, expect, it } from 'vitest';

import { defaultChannelTitle } from './channelTitle';

const format = {
  more: (names: string, rest: number, total: number) => `${names} +${rest}/${total}`,
  separator: '、',
};

describe('defaultChannelTitle', () => {
  it('lists up to three members in selection order', () => {
    expect(defaultChannelTitle(['锦妍', 'Codex', 'Pi'], format, 100)).toBe('锦妍、Codex、Pi');
    expect(defaultChannelTitle(['Codex'], format, 100)).toBe('Codex');
  });

  it('summarizes the rest instead of listing every member', () => {
    expect(defaultChannelTitle(['A', 'B', 'C', 'D', 'E'], format, 100)).toBe('A、B、C +2/5');
  });

  it('skips blank names and stays within the length limit without splitting characters', () => {
    expect(defaultChannelTitle([' ', 'A'], format, 100)).toBe('A');
    expect(defaultChannelTitle([], format, 100)).toBe('');
    expect(defaultChannelTitle(['😀😀😀'], format, 5)).toBe('😀😀');
  });
});

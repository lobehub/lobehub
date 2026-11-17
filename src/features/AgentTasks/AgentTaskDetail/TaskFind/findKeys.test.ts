import { describe, expect, it } from 'vitest';

import { resolveFindKey } from './findKeys';

describe('resolveFindKey', () => {
  it('steps with Enter, Shift+Enter and the arrows', () => {
    expect(resolveFindKey('Enter', false)).toBe('next');
    expect(resolveFindKey('Enter', true)).toBe('prev');
    expect(resolveFindKey('ArrowDown', false)).toBe('next');
    expect(resolveFindKey('ArrowUp', false)).toBe('prev');
  });

  it('closes with Escape and leaves typing alone', () => {
    expect(resolveFindKey('Escape', false)).toBe('close');
    expect(resolveFindKey('a', false)).toBeUndefined();
    expect(resolveFindKey('Backspace', true)).toBeUndefined();
  });
});

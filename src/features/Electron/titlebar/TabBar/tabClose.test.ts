import { describe, expect, it } from 'vitest';

import { isTabClosable, shouldCloseOnAuxClick } from './tabClose';

describe('isTabClosable', () => {
  it('keeps a lone tab open', () => {
    expect(isTabClosable(1)).toBe(false);
  });

  it('allows closing once another tab exists', () => {
    expect(isTabClosable(2)).toBe(true);
  });
});

describe('shouldCloseOnAuxClick', () => {
  it('ignores middle-click on a lone tab', () => {
    expect(shouldCloseOnAuxClick(1, 1)).toBe(false);
  });

  it('closes on middle-click once another tab exists', () => {
    expect(shouldCloseOnAuxClick(1, 2)).toBe(true);
  });

  it('ignores other auxiliary buttons', () => {
    expect(shouldCloseOnAuxClick(2, 3)).toBe(false);
  });
});

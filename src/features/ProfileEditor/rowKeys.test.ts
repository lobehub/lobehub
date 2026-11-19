import { describe, expect, it } from 'vitest';

import { shouldActivateRow } from './rowKeys';

describe('shouldActivateRow', () => {
  const row = {};

  it.each(['Enter', ' '])('opens on %j when the row itself has focus', (key) => {
    expect(shouldActivateRow({ currentTarget: row, key, target: row })).toBe(true);
  });

  it('leaves other keys alone', () => {
    expect(shouldActivateRow({ currentTarget: row, key: 'a', target: row })).toBe(false);
  });

  it('leaves a key pressed on a control inside the row to that control', () => {
    expect(shouldActivateRow({ currentTarget: row, key: 'Enter', target: {} })).toBe(false);
  });
});

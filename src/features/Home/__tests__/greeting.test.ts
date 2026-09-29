import { describe, expect, it } from 'vitest';

import { getGreetingKey } from '../greeting';

describe('getGreetingKey', () => {
  it.each([
    [0, 'evening'],
    [5, 'evening'],
    [6, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [23, 'evening'],
  ] as const)('greets local hour %i as %s', (hour, expected) => {
    expect(getGreetingKey(hour)).toBe(expected);
  });
});

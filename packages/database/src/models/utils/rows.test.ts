import { describe, expect, it } from 'vitest';

import { countOf, firstRow, nonNull } from './rows';

describe('nonNull', () => {
  it('returns present values, including falsy ones', () => {
    expect(nonNull('a', 'x')).toBe('a');
    expect(nonNull(0, 'x')).toBe(0);
    expect(nonNull('', 'x')).toBe('');
    expect(nonNull(false, 'x')).toBe(false);
  });

  it('throws with the context when the value is null or undefined', () => {
    expect(() => nonNull(null, 'messages.parent_id')).toThrow(
      'Expected a value for messages.parent_id, got null',
    );
    expect(() => nonNull(undefined, 'messages.parent_id')).toThrow(
      'Expected a value for messages.parent_id, got undefined',
    );
  });
});

describe('firstRow', () => {
  it('returns the first row', () => {
    expect(firstRow([{ id: 1 }, { id: 2 }], 'rows')).toEqual({ id: 1 });
  });

  it('throws with the context when there is no row', () => {
    expect(() => firstRow([], 'the agent count')).toThrow(
      'Expected a value for the first row of the agent count, got undefined',
    );
  });
});

describe('countOf', () => {
  it('reads the count of the single row', () => {
    expect(countOf([{ count: 3 }], 'rows')).toBe(3);
    expect(countOf([{ count: 0 }], 'rows')).toBe(0);
  });

  it('converts a text count(*) to a number', () => {
    expect(countOf([{ count: '42' }], 'rows')).toBe(42);
  });

  it('throws instead of returning 0 when the count row is missing', () => {
    expect(() => countOf([], 'workspace memberships')).toThrow(
      'Expected a value for the first row of workspace memberships, got undefined',
    );
  });
});

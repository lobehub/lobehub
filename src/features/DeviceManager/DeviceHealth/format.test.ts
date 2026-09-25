import { describe, expect, it } from 'vitest';

import { formatLoad, formatPercent } from './format';

describe('device health formatters', () => {
  // The chart calls its formatter for every slot, including slots with no
  // samples — a null load used to crash the whole settings page.
  it('render a gap slot as a dash', () => {
    expect(formatLoad(null)).toBe('—');
    expect(formatPercent(null)).toBe('—');
    expect(formatLoad(undefined)).toBe('—');
  });

  it('format present values', () => {
    expect(formatLoad(1.234)).toBe('1.23');
    expect(formatPercent(41.6)).toBe('42%');
  });
});

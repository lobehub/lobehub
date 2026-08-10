import { describe, expect, it } from 'vitest';

import { formatGroupedNumberInput, parseGroupedNumberInput } from './groupedNumberInput';

describe('formatGroupedNumberInput', () => {
  it('groups every three digits', () => {
    expect(formatGroupedNumberInput(1000)).toBe('1,000');
    expect(formatGroupedNumberInput(1_234_567)).toBe('1,234,567');
    expect(formatGroupedNumberInput('1234567.89')).toBe('1,234,567.89');
  });

  it('preserves sign and empty values', () => {
    expect(formatGroupedNumberInput(-12_345)).toBe('-12,345');
    expect(formatGroupedNumberInput(undefined)).toBe('');
    expect(formatGroupedNumberInput('')).toBe('');
    expect(formatGroupedNumberInput(0)).toBe('0');
  });
});

describe('parseGroupedNumberInput', () => {
  it('strips ascii and unicode grouping separators', () => {
    expect(parseGroupedNumberInput('1,234,567.89')).toBe('1234567.89');
    expect(parseGroupedNumberInput('1٬234٬567')).toBe('1234567');
    expect(parseGroupedNumberInput('1 234 567')).toBe('1234567');
  });

  it('normalizes arabic decimal separator', () => {
    expect(parseGroupedNumberInput('12٫5')).toBe('12.5');
  });

  it('returns empty for missing input', () => {
    expect(parseGroupedNumberInput(undefined)).toBe('');
    expect(parseGroupedNumberInput('')).toBe('');
  });
});

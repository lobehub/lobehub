import { describe, expect, it } from 'vitest';

import {
  canPropose,
  displayChartNumber,
  displayValue,
  selectedOptionKey,
  selectedOptionValue,
} from './display';

describe('native renderer values', () => {
  it('preserves nonzero small-scale values in metrics and chart labels', () => {
    expect(displayValue(0.000001, 'en-US')).toBe('1E-6');
    expect(displayValue(-0.000001, 'en-US')).toBe('-1E-6');
    expect(displayChartNumber(0.004, 'en-US')).toBe('4E-3');
    expect(displayChartNumber(-0.0000004, 'en-US')).toBe('-4E-7');
    expect(displayChartNumber(0, 'en-US')).toBe('0');
  });

  it('shows unavailable values without coercing them into numeric zero', () => {
    expect(displayValue(null)).toBe('—');
    expect(displayValue(Number.NaN)).toBe('—');
    expect(displayValue(Infinity)).toBe('—');
    expect(displayValue(0, 'en-US')).toBe('0');
    expect(displayValue(1500.5, 'en-US')).toBe('1,500.5');
    expect(displayValue('')).toBe('');
    expect(displayValue(false)).toBe('false');
  });

  it('keeps typed option values separate and rejects fabricated option indices', () => {
    const options = [{ value: 1 }, { value: '1' }, { value: false }];
    expect(selectedOptionKey(options, 1)).toBe('0');
    expect(selectedOptionKey(options, '1')).toBe('1');
    expect(selectedOptionKey(options, false)).toBe('2');
    expect(selectedOptionKey(options, 'missing')).toBeUndefined();
    expect(selectedOptionValue(options, '2')).toBe(false);
    for (const key of ['-1', '100', '__proto__', '1.5', '01', 1, null, ['1']]) {
      expect(selectedOptionValue(options, key)).toBeUndefined();
    }
  });

  it('prepares text only from an explicit trusted enabled action', () => {
    expect(canPropose('Continue with this choice', { trusted: true })).toBe(true);
    expect(canPropose('Continue', { trusted: false })).toBe(false);
    expect(canPropose('Continue', { disabled: true, trusted: true })).toBe(false);
    expect(canPropose('Continue', { readOnly: true, trusted: true })).toBe(false);
    expect(canPropose(null, { trusted: true })).toBe(false);
    expect(canPropose(42, { trusted: true })).toBe(false);
    expect(canPropose('   ', { trusted: true })).toBe(false);
  });
});

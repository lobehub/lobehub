import { describe, expect, it } from 'vitest';

import {
  confirmedUnusedMicro,
  microUsdToDecimalString,
  openRouterUsdToMicroFloor,
  periodToOpenRouterLimitReset,
  tomanToMicroUsd,
  usdDecimalStringToMicro,
} from '../aicoMoney';

describe('aicoMoney (final remediation)', () => {
  it('maps periods to OpenRouter limit_reset', () => {
    expect(periodToOpenRouterLimitReset('total')).toBeNull();
    expect(periodToOpenRouterLimitReset('daily')).toBe('daily');
    expect(periodToOpenRouterLimitReset('weekly')).toBe('weekly');
    expect(periodToOpenRouterLimitReset('monthly')).toBe('monthly');
  });

  it('round-trips precision-heavy decimals as strings', () => {
    const micro = usdDecimalStringToMicro('12.345678');
    expect(micro).toBe(12_345_678n);
    expect(microUsdToDecimalString(micro)).toBe('12.345678');
  });

  it('handles very large values without float', () => {
    const micro = usdDecimalStringToMicro('999999999.123456');
    expect(microUsdToDecimalString(micro)).toBe('999999999.123456');
  });

  it('sums repeatedly in integer space', () => {
    let sum = 0n;
    for (let i = 0; i < 1000; i++) sum += usdDecimalStringToMicro('0.000001');
    expect(sum).toBe(1000n);
    expect(microUsdToDecimalString(sum)).toBe('0.001000');
  });

  it('floors OpenRouter USD and never over-refunds', () => {
    expect(openRouterUsdToMicroFloor(1.9999999)).toBe(1_999_999n);
    expect(confirmedUnusedMicro(1_000_000n, 400_001n)).toBe(599_999n);
    expect(confirmedUnusedMicro(100n, 200n)).toBe(0n);
  });

  it('FX toman→micro floors toward Aico', () => {
    // 50_001 toman at 50_000 toman/USD → floor to < 1.000020 USD
    expect(tomanToMicroUsd(50_001, 50_000)).toBe(1_000_020n);
  });

  it('rejects malformed / negative / non-decimal money inputs', () => {
    expect(() => usdDecimalStringToMicro('NaN')).toThrow();
    expect(() => usdDecimalStringToMicro('Infinity')).toThrow();
    expect(() => usdDecimalStringToMicro('1.2.3')).toThrow();
    expect(() => tomanToMicroUsd(-1, 50_000)).toThrow();
    expect(() => openRouterUsdToMicroFloor(Number.NaN)).toThrow();
  });
});

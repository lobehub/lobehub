import { describe, expect, it } from 'vitest';

import { buildKimiCodeQuotaWindows, kimiCodeQuotaReadings } from './kimiCode';
import { projectWindows } from './windows';

const now = 1_800_000_000_000;
const windows = {
  monthly: { resetsAt: now + 180_000, usedPercent: 50, windowMinutes: 43_200 },
  monthlyCode: { resetsAt: now + 240_000, usedPercent: 33, windowMinutes: 43_200 },
  session: { resetsAt: now + 60_000, usedPercent: 23, windowMinutes: 300 },
  weekly: { resetsAt: now + 120_000, usedPercent: 41, windowMinutes: 10_080 },
};

describe('Kimi Code persisted quota projection', () => {
  it('roundtrips all four windows through unified readings', () => {
    const readings = kimiCodeQuotaReadings(windows, now);
    expect(buildKimiCodeQuotaWindows(readings, now)).toEqual(windows);
    expect(projectWindows(readings)[2].windowSeconds).toBe(43_200 * 60);
  });

  it('maps each window to its limit type with an explicit window length', () => {
    const readings = kimiCodeQuotaReadings(windows, now);

    expect(readings.map((reading) => [reading.limitType, reading.windowMinutes])).toEqual([
      ['session', 300],
      ['weekly_all', 10_080],
      ['month_total', 43_200],
      ['month_code', 43_200],
    ]);
    expect(readings.every((reading) => reading.scopeKey === '')).toBe(true);
  });

  it('omits windows the provider did not report', () => {
    const readings = kimiCodeQuotaReadings(
      { monthly: null, monthlyCode: null, session: windows.session, weekly: null },
      now,
    );

    expect(readings).toHaveLength(1);
    expect(buildKimiCodeQuotaWindows(readings, now)).toEqual({
      monthly: null,
      monthlyCode: null,
      session: windows.session,
      weekly: null,
    });
  });

  it('selects the latest reading independently per limit and refills expired windows', () => {
    const old = kimiCodeQuotaReadings(windows, now);
    const newer = { ...old[0], capturedAt: now + 1, utilization: 55 };
    expect(buildKimiCodeQuotaWindows([...old, newer], now).session?.usedPercent).toBe(55);
    expect(buildKimiCodeQuotaWindows(old, now + 120_001).weekly?.usedPercent).toBe(0);
    expect(buildKimiCodeQuotaWindows(old, now + 120_001).monthly?.usedPercent).toBe(50);
  });
});

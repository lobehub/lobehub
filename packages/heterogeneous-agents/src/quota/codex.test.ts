import { describe, expect, it } from 'vitest';

import { buildCodexRateLimits, codexQuotaReadings } from './codex';
import { projectWindows } from './windows';

const now = 1_800_000_000_000;
const limits = [
  {
    limitId: 'codex',
    limitName: null,
    primary: { resetsAt: now + 60000, usedPercent: 23, windowMinutes: 300 },
    secondary: null,
  },
  {
    limitId: 'other',
    limitName: 'Other models',
    primary: null,
    secondary: { resetsAt: now + 120000, usedPercent: 41, windowMinutes: 43200 },
  },
];

describe('Codex persisted quota projection', () => {
  it('roundtrips multiple buckets and monthly durations through unified readings', () => {
    const readings = codexQuotaReadings(limits, now);
    expect(buildCodexRateLimits(readings, now)).toEqual(limits);
    expect(projectWindows(readings)[1].windowSeconds).toBe(43200 * 60);
  });
  it('selects the latest reading independently per bucket and refills expired windows', () => {
    const old = codexQuotaReadings(limits, now);
    const newer = { ...old[0], capturedAt: now + 1, utilization: 55 };
    expect(buildCodexRateLimits([...old, newer], now)[0].primary?.usedPercent).toBe(55);
    expect(buildCodexRateLimits(old, now + 120001)[1].secondary?.usedPercent).toBe(0);
  });
});

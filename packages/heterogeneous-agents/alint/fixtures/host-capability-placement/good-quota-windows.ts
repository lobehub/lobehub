// Fixture: src/quota/windows.ts — projects quota readings the device already sampled into display windows.
import type { QuotaLimitReading } from './types';

export interface ProjectedWindow {
  endsAt: number;
  startsAt: number;
  utilization: number;
}

export const projectWindows = (readings: QuotaLimitReading[], now: number): ProjectedWindow[] =>
  readings
    .filter((reading) => reading.resetsAt > now)
    .map((reading) => ({
      endsAt: reading.resetsAt,
      startsAt: reading.resetsAt - reading.windowSeconds * 1000,
      utilization: reading.utilization,
    }));

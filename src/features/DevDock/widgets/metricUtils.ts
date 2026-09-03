const HIGH_PRIVATE_BYTES = 1024 ** 3;

export interface LayoutShiftEntry {
  hadRecentInput: boolean;
  value: number;
}

export const isMemoryHigh = (heapPercent: number, privateBytes?: number) =>
  heapPercent >= 90 || (privateBytes ?? 0) >= HIGH_PRIVATE_BYTES;

export const sumLayoutShifts = (entries: LayoutShiftEntry[]) =>
  entries.reduce((sum, entry) => sum + (entry.hadRecentInput ? 0 : entry.value), 0);

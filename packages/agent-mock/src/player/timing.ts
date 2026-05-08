import type { SpeedMultiplier } from '../types';

export function applySpeed(delayMs: number, speed: SpeedMultiplier): number {
  if (speed === 'instant') return 0;
  return Math.max(0, Math.round(delayMs / speed));
}

import type { HeteroQuotaWindow } from '@lobechat/electron-client-ipc';

export const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

/**
 * Remaining percent of a window as the panel shows it at `now`. A window whose
 * reset time has already passed has refilled even if no newer sample arrived
 * yet, so it reads 100% instead of keeping the pre-reset value on screen.
 */
export const getWindowLeftPercent = (window: HeteroQuotaWindow, now: number): number => {
  if (window.resetsAt != null && window.resetsAt <= now) return 100;

  return clampPercent(100 - window.usedPercent);
};

export interface BindingWindow {
  key: string;
  label: string;
  leftPercent: number;
  resetsAt: number | null;
}

/**
 * The window currently limiting the user: the one with the least remaining.
 * On a tie the earlier window in display order wins, so the badge stays stable
 * instead of flipping between two equal windows. The collapsed badge shows only
 * this window, with its name, and the popover highlights the same row.
 */
export const pickBindingWindow = (
  items: { key: string; label: string; window: HeteroQuotaWindow | null }[],
  now: number,
): BindingWindow | undefined => {
  let binding: BindingWindow | undefined;

  for (const { key, label, window } of items) {
    if (!window) continue;

    const leftPercent = getWindowLeftPercent(window, now);
    if (!binding || leftPercent < binding.leftPercent) {
      binding = { key, label, leftPercent, resetsAt: window.resetsAt };
    }
  }

  return binding;
};

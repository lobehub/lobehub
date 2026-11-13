import {
  buildClaudeQuotaWindows,
  type HeteroQuotaWindow,
  type QuotaDisplayReading,
} from '@lobechat/heterogeneous-agents/quota';

/** Below this share left, a window reads as running low. */
export const LOW_LOAD_LEFT_PERCENT = 15;

export type LoadLevel = 'exhausted' | 'low' | 'ok';

export interface WindowLoad {
  leftPercent: number;
  level: LoadLevel;
  /** Time until the window refills; absent when the provider gave no reset or it already passed. */
  resetsInMs?: number;
}

export interface AccountLoad {
  session?: WindowLoad;
  weekly?: WindowLoad;
}

const toLoad = (window: HeteroQuotaWindow | null, now: number): WindowLoad | undefined => {
  if (!window) return;
  const leftPercent = Math.min(100, Math.max(0, Math.round(100 - window.usedPercent)));
  const resetsInMs = window.resetsAt && window.resetsAt > now ? window.resetsAt - now : undefined;

  return {
    leftPercent,
    level: leftPercent === 0 ? 'exhausted' : leftPercent < LOW_LOAD_LEFT_PERCENT ? 'low' : 'ok',
    resetsInMs,
  };
};

/**
 * What an account card shows of its load: the 5-hour session and the weekly
 * window, as the share still left. A window that already rolled over counts as
 * refilled (the same rule the balancer applies), not as its last reading.
 */
export const accountLoadOf = (readings: QuotaDisplayReading[], now: number): AccountLoad => {
  const windows = buildClaudeQuotaWindows(readings, now);

  return { session: toLoad(windows.session, now), weekly: toLoad(windows.weekly, now) };
};

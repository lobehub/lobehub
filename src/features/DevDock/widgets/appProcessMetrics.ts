import type { AppProcessMetrics } from '@lobechat/electron-client-ipc';
import { useSyncExternalStore } from 'react';

import { electronDevtoolsService } from '@/services/electron/devtools';

const SAMPLE_INTERVAL = 2000;

const listeners = new Set<() => void>();

let snapshot: AppProcessMetrics | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let primed = false;

const sample = async () => {
  try {
    const next = await electronDevtoolsService.getAppProcessMetrics();
    // Electron reports cpu usage since the previous getAppMetrics call, so the
    // first sample covers an arbitrary window — prime once and drop it.
    if (!primed) {
      primed = true;
      return;
    }
    snapshot = next;
    for (const listener of listeners) listener();
  } catch {
    /* ipc unavailable — widgets stay hidden */
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!timer) {
    primed = false;
    void sample();
    timer = setInterval(sample, SAMPLE_INTERVAL);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || !timer) return;
    clearInterval(timer);
    timer = null;
    snapshot = null;
  };
};

const getSnapshot = () => snapshot;

// Every reader shares this one sampler: cpu usage is relative to the previous
// getAppMetrics call, so a second independent poller would corrupt both readings.
export const useAppProcessMetrics = (): AppProcessMetrics | null =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

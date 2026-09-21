import type { RendererMemoryInfo } from '@lobechat/electron-client-ipc';
import { useSyncExternalStore } from 'react';

export interface MemorySample {
  at: number;
  jsHeapLimitBytes: number;
  jsHeapUsedBytes: number;
  renderer: RendererMemoryInfo | null;
}

export interface MemorySamples {
  history: MemorySample[];
  latest: MemorySample;
}

const SAMPLE_INTERVAL = 2000;
export const MAX_HISTORY = 150;

const listeners = new Set<() => void>();
let snapshot: MemorySamples | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const readHeap = () => {
  const memory = (
    performance as Performance & {
      memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number };
    }
  ).memory;
  if (!memory) return null;
  return { jsHeapLimitBytes: memory.jsHeapSizeLimit, jsHeapUsedBytes: memory.usedJSHeapSize };
};

export const isMemorySamplingSupported = () => readHeap() !== null;

const sample = async () => {
  let renderer: RendererMemoryInfo | null = null;
  try {
    renderer = (await window.electronAPI?.getRendererMemoryInfo?.()) ?? null;
  } catch {
    /* native process metrics unavailable — JS heap remains useful */
  }
  const heap = readHeap();
  if (!heap || !timer) return;

  const latest: MemorySample = { ...heap, at: Date.now(), renderer };
  const history = [...(snapshot?.history ?? []), latest].slice(-MAX_HISTORY);
  snapshot = { history, latest };
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(sample, SAMPLE_INTERVAL);
    void sample();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || !timer) return;
    clearInterval(timer);
    timer = null;
  };
};

const getSnapshot = () => snapshot;

// History survives panel open/close on purpose: the widget keeps this sampler
// subscribed, so the panel opens onto the trend instead of an empty chart.
export const useMemorySamples = (): MemorySamples | null =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

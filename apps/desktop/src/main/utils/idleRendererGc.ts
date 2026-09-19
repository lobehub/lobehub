import type { WebContents } from 'electron';
import { app, BrowserWindow } from 'electron';

import { createLogger } from '@/utils/logger';

const logger = createLogger('utils:idleRendererGc');

export const IDLE_GC_RESIDENT_BYTES = 1.5 * 1024 ** 3;
export const IDLE_GC_TICK_MS = 30_000;
export const IDLE_GC_COOLDOWN_MS = 5 * 60_000;

// HeapProfiler.collectGarbage is the DevTools trash icon: a full V8 + Oilpan GC that
// also decommits the freed blink_gc pages, which plain window.gc() does not.
export const collectRendererGarbage = async (contents: WebContents) => {
  const dbg = contents.debugger;
  const attachedHere = !dbg.isAttached();
  if (attachedHere) dbg.attach('1.3');
  try {
    await dbg.sendCommand('HeapProfiler.collectGarbage');
  } finally {
    if (attachedHere) dbg.detach();
  }
};

interface IdleRendererGcDeps {
  collect: (contents: WebContents) => Promise<void>;
  getFocusedWindow: () => BrowserWindow | null;
  getResidentBytes: () => Map<number, number>;
  getWindows: () => BrowserWindow[];
  now: () => number;
}

const defaultDeps: IdleRendererGcDeps = {
  collect: collectRendererGarbage,
  getFocusedWindow: () => BrowserWindow.getFocusedWindow(),
  getResidentBytes: () =>
    new Map(app.getAppMetrics().map((m) => [m.pid, m.memory.workingSetSize * 1024])),
  getWindows: () => BrowserWindow.getAllWindows(),
  now: Date.now,
};

export const createIdleRendererGcTick = (deps: Partial<IdleRendererGcDeps> = {}) => {
  const { collect, getFocusedWindow, getResidentBytes, getWindows, now } = {
    ...defaultDeps,
    ...deps,
  };
  let idleTicks = 0;
  const lastRunAt = new Map<number, number>();

  return async () => {
    if (getFocusedWindow()) {
      idleTicks = 0;
      return;
    }
    if (++idleTicks < 2) return;

    const resident = getResidentBytes();
    const renderers = new Map<number, WebContents>();
    for (const win of getWindows()) {
      if (!win.webContents.isDestroyed()) {
        renderers.set(win.webContents.getOSProcessId(), win.webContents);
      }
    }

    for (const [pid, contents] of renderers) {
      const bytes = resident.get(pid) ?? 0;
      if (bytes < IDLE_GC_RESIDENT_BYTES) continue;
      const last = lastRunAt.get(pid);
      if (last !== undefined && now() - last < IDLE_GC_COOLDOWN_MS) continue;
      lastRunAt.set(pid, now());
      try {
        await collect(contents);
        logger.info(`Collected renderer ${pid} garbage while idle (resident ${bytes} bytes)`);
      } catch (error) {
        logger.warn(`Idle GC failed for renderer ${pid}`, error);
      }
    }
  };
};

export const startIdleRendererGc = () => {
  const timer = setInterval(createIdleRendererGcTick(), IDLE_GC_TICK_MS);
  return () => clearInterval(timer);
};

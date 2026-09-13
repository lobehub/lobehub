import { describe, expect, it, vi } from 'vitest';

import {
  createIdleRendererGcTick,
  IDLE_GC_COOLDOWN_MS,
  IDLE_GC_RESIDENT_BYTES,
} from '../idleRendererGc';

vi.mock('electron', () => ({ BrowserWindow: {}, app: {} }));

const GB = 1024 ** 3;

const makeWindow = (pid: number) =>
  ({ webContents: { getOSProcessId: () => pid, isDestroyed: () => false } }) as any;

const setup = (overrides: { focused?: boolean; resident?: number } = {}) => {
  const collect = vi.fn(async () => {});
  let now = 0;
  const tick = createIdleRendererGcTick({
    collect,
    getFocusedWindow: () => (overrides.focused ? ({} as any) : null),
    getResidentBytes: () => new Map([[42, overrides.resident ?? 2 * GB]]),
    getWindows: () => [makeWindow(42)],
    now: () => now,
  });
  return { advance: (ms: number) => (now += ms), collect, tick };
};

describe('createIdleRendererGcTick', () => {
  it('collects a heavy renderer only after two consecutive idle ticks', async () => {
    const { collect, tick } = setup();
    await tick();
    expect(collect).not.toHaveBeenCalled();
    await tick();
    expect(collect).toHaveBeenCalledOnce();
  });

  it('resets the idle streak when a window is focused', async () => {
    const collect = vi.fn(async () => {});
    let focused = false;
    const tick = createIdleRendererGcTick({
      collect,
      getFocusedWindow: () => (focused ? ({} as any) : null),
      getResidentBytes: () => new Map([[42, 2 * GB]]),
      getWindows: () => [makeWindow(42)],
      now: () => 0,
    });
    await tick();
    focused = true;
    await tick();
    focused = false;
    await tick();
    expect(collect).not.toHaveBeenCalled();
  });

  it('skips renderers below the resident threshold', async () => {
    const { collect, tick } = setup({ resident: IDLE_GC_RESIDENT_BYTES - 1 });
    await tick();
    await tick();
    expect(collect).not.toHaveBeenCalled();
  });

  it('honours the per-renderer cooldown', async () => {
    const { advance, collect, tick } = setup();
    await tick();
    await tick();
    advance(IDLE_GC_COOLDOWN_MS - 1);
    await tick();
    expect(collect).toHaveBeenCalledOnce();
    advance(1);
    await tick();
    expect(collect).toHaveBeenCalledTimes(2);
  });
});

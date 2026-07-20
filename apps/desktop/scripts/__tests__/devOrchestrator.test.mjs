import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDevOrchestrator } from '../devOrchestrator.mjs';

class FakeChild extends EventEmitter {
  kill = vi.fn();
}

const createHarness = (overrides = {}) => {
  const spawned = [];
  const watchers = [];
  const state = { bundlesExist: false, mtime: 1, portReady: false };

  const options = {
    checkPort: vi.fn(async () => state.portReady),
    desktopRoot: '/repo/apps/desktop',
    electronBin: '/bin/electron',
    exit: vi.fn(),
    existsSync: vi.fn(() => state.bundlesExist),
    log: vi.fn(),
    logError: vi.fn(),
    nodeBin: '/bin/node',
    spawn: vi.fn((bin, args, opts) => {
      const child = new FakeChild();
      spawned.push({ args, bin, child, opts });
      return child;
    }),
    statSync: vi.fn(() => ({ mtimeMs: state.mtime })),
    viteBin: '/repo/node_modules/vite/bin/vite.js',
    vitePort: 5199,
    watch: vi.fn((dir, cb) => {
      watchers.push(cb);
    }),
    ...overrides,
  };

  const orchestrator = createDevOrchestrator(options);
  const viteChildren = () => spawned.filter((s) => s.bin === '/bin/node');
  const electronSpawns = () => spawned.filter((s) => s.bin === '/bin/electron');

  const becomeReady = async () => {
    state.bundlesExist = true;
    state.portReady = true;
    await vi.advanceTimersByTimeAsync(2000);
  };

  return {
    becomeReady,
    electronSpawns,
    options,
    orchestrator,
    spawned,
    state,
    viteChildren,
    watchers,
  };
};

describe('createDevOrchestrator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spawns the three vite processes through the node binary (no pnpm shim)', () => {
    const h = createHarness();
    h.orchestrator.start();

    expect(h.viteChildren()).toHaveLength(3);
    for (const { args, opts } of h.viteChildren()) {
      expect(args[0]).toBe('/repo/node_modules/vite/bin/vite.js');
      expect(opts.cwd).toBe('/repo/apps/desktop');
    }
    const configs = h.viteChildren().map(({ args }) => args.at(-1));
    expect(configs).toEqual([
      'vite.renderer.config.ts',
      'vite.main.config.ts',
      'vite.preload.config.ts',
    ]);
  });

  it('shuts everything down when a vite child exits early', () => {
    const h = createHarness();
    h.orchestrator.start();

    h.viteChildren()[1].child.emit('exit', 7);

    expect(h.options.exit).toHaveBeenCalledWith(7);
    for (const { child } of h.viteChildren()) {
      expect(child.kill).toHaveBeenCalled();
    }
    expect(h.electronSpawns()).toHaveLength(0);
  });

  it('launches electron only after bundles are stable and the renderer port accepts', async () => {
    const h = createHarness();
    h.orchestrator.start();

    h.state.bundlesExist = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.electronSpawns()).toHaveLength(0);

    h.state.portReady = true;
    await vi.advanceTimersByTimeAsync(400);

    expect(h.electronSpawns()).toHaveLength(1);
    const { args, opts } = h.electronSpawns()[0];
    expect(args).toEqual(['.']);
    expect(opts.env.ELECTRON_RENDERER_URL).toBe('http://127.0.0.1:5199');
    expect(opts.env.NODE_ENV).toBe('development');
    expect(h.options.watch).toHaveBeenCalledTimes(2);
  });

  it('waits for the bundle signature to stay quiet before launching', async () => {
    const h = createHarness();
    h.orchestrator.start();
    h.state.bundlesExist = true;
    h.state.portReady = true;

    await vi.advanceTimersByTimeAsync(600);
    h.state.mtime = 2;
    await vi.advanceTimersByTimeAsync(600);
    expect(h.electronSpawns()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1400);
    expect(h.electronSpawns()).toHaveLength(1);
  });

  it('passes extra CLI args through to electron', async () => {
    const h = createHarness({ electronArgs: ['--remote-debugging-port=9223', '--foo'] });
    h.orchestrator.start();
    await h.becomeReady();

    expect(h.electronSpawns()[0].args).toEqual(['.', '--remote-debugging-port=9223', '--foo']);
  });

  it('restarts electron when a bundle change fires the watcher', async () => {
    const h = createHarness();
    h.orchestrator.start();
    await h.becomeReady();

    const electron = h.electronSpawns()[0].child;
    h.watchers[0]('change');
    await vi.advanceTimersByTimeAsync(500);
    expect(electron.kill).toHaveBeenCalled();

    electron.emit('exit', null);
    expect(h.electronSpawns()).toHaveLength(2);
    expect(h.options.exit).not.toHaveBeenCalled();
  });

  it('debounces rapid bundle changes into one restart', async () => {
    const h = createHarness();
    h.orchestrator.start();
    await h.becomeReady();

    const electron = h.electronSpawns()[0].child;
    h.watchers[0]('change');
    await vi.advanceTimersByTimeAsync(200);
    h.watchers[1]('change');
    await vi.advanceTimersByTimeAsync(500);

    expect(electron.kill).toHaveBeenCalledTimes(1);
  });

  it('stops the watchers when electron is quit by hand', async () => {
    const h = createHarness();
    h.orchestrator.start();
    await h.becomeReady();

    h.electronSpawns()[0].child.emit('exit', 0);

    expect(h.options.exit).toHaveBeenCalledWith(0);
    for (const { child } of h.viteChildren()) {
      expect(child.kill).toHaveBeenCalled();
    }
  });

  it('shutdown kills electron and all vite children exactly once', async () => {
    const h = createHarness();
    h.orchestrator.start();
    await h.becomeReady();

    h.orchestrator.shutdown(0);
    h.orchestrator.shutdown(1);

    expect(h.options.exit).toHaveBeenCalledTimes(1);
    expect(h.options.exit).toHaveBeenCalledWith(0);
    expect(h.electronSpawns()[0].child.kill).toHaveBeenCalled();
    for (const { child } of h.viteChildren()) {
      expect(child.kill).toHaveBeenCalled();
    }
  });

  it('fails with exit(1) when the initial build never produces bundles', async () => {
    const h = createHarness();
    h.orchestrator.start();

    await vi.advanceTimersByTimeAsync(121_000);

    expect(h.options.logError).toHaveBeenCalled();
    expect(h.options.exit).toHaveBeenCalledWith(1);
    expect(h.electronSpawns()).toHaveLength(0);
  });
});

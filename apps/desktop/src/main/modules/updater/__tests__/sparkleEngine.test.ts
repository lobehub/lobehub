import type { SparkleBridge, SparkleBridgeEvent } from 'electron-sparkle-updater';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SparkleEngine } from '../sparkleEngine';

const { mockLoadBridge, mockAppOn } = vi.hoisted(() => ({
  mockAppOn: vi.fn(),
  mockLoadBridge: vi.fn(),
}));

vi.mock('electron-sparkle-updater', () => ({ loadSparkleBridge: mockLoadBridge }));

vi.mock('electron', () => ({ app: { isPackaged: true, on: mockAppOn } }));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const createBridge = () => {
  let handler: ((event: SparkleBridgeEvent) => void) | null | undefined;
  const bridge: SparkleBridge = {
    checkForUpdates: vi.fn(),
    init: vi.fn().mockReturnValue(true),
    installUpdateNow: vi.fn(),
    installUpdateOnQuit: vi.fn(),
    setAutomaticChecks: vi.fn(),
    setEventHandler: vi.fn((fn) => {
      handler = fn;
    }),
  };
  return { bridge, emit: (event: SparkleBridgeEvent) => handler?.(event) };
};

describe('SparkleEngine.create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (process as any).resourcesPath = '/Applications/LobeHub.app/Contents/Resources';
  });

  it('rejects when no bridge is available', async () => {
    mockLoadBridge.mockReturnValue(null);

    await expect(
      SparkleEngine.create({ appcastUrl: 'https://cdn/appcast.xml', currentVersion: '1.0.0' }),
    ).rejects.toThrow(/Sparkle bridge/);
  });

  it('rejects when Sparkle fails to initialize', async () => {
    const { bridge } = createBridge();
    vi.mocked(bridge.init).mockReturnValue(false);
    mockLoadBridge.mockReturnValue(bridge);

    await expect(
      SparkleEngine.create({ appcastUrl: 'https://cdn/appcast.xml', currentVersion: '1.0.0' }),
    ).rejects.toThrow(/Sparkle bridge/);
  });

  it('initializes with the feed url and disables Sparkle scheduled checks', async () => {
    const { bridge } = createBridge();
    mockLoadBridge.mockReturnValue(bridge);

    const engine = await SparkleEngine.create({
      appcastUrl: 'https://cdn/canary/appcast-arm64.xml',
      currentVersion: '1.0.0',
    });

    expect(engine?.kind).toBe('sparkle');
    expect(mockLoadBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        addonPath: expect.stringMatching(/[/\\]sparkle[/\\]sparkle_bridge\.node$/),
        isPackaged: true,
      }),
    );
    expect(bridge.init).toHaveBeenCalledWith({
      appcastUrl: 'https://cdn/canary/appcast-arm64.xml',
    });
    expect(bridge.setAutomaticChecks).toHaveBeenCalledWith(false);
  });
});

describe('SparkleEngine', () => {
  const setup = () => {
    const { bridge, emit } = createBridge();
    const engine = new SparkleEngine(bridge, '1.0.0', 'https://cdn');
    return { bridge, emit, engine };
  };

  it('releases native callbacks on quit so deferred installation can finish', () => {
    const { bridge } = setup();
    const quit = mockAppOn.mock.calls.findLast(([event]) => event === 'will-quit')?.[1];
    quit();
    expect(bridge.setEventHandler).toHaveBeenLastCalledWith(null);
  });

  it('delegates commands to the bridge without a separate download step', async () => {
    const { bridge, emit, engine } = setup();

    const check = engine.checkForUpdates();
    emit({ type: 'update-not-available' });
    await check;
    await engine.downloadUpdate();
    engine.installOnQuit();
    engine.quitAndInstall();

    expect(bridge.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(bridge.installUpdateOnQuit).toHaveBeenCalledTimes(1);
    expect(bridge.installUpdateNow).toHaveBeenCalledTimes(1);
  });

  it('keeps a native check pending until the download completes', async () => {
    const { emit, engine } = setup();
    engine.on('error', () => {});
    const complete = vi.fn();
    const check = engine.checkForUpdates().then(complete);
    emit({ type: 'update-available', version: '2.0.0' });
    await Promise.resolve();
    expect(complete).not.toHaveBeenCalled();
    emit({ type: 'update-downloaded', version: '2.0.0' });
    await check;
    expect(complete).toHaveBeenCalledOnce();
  });

  it('maps the Sparkle lifecycle onto electron-updater events', () => {
    const { emit, engine } = setup();
    const events: Array<[string, unknown]> = [];
    for (const name of [
      'checking-for-update',
      'update-available',
      'update-not-available',
      'update-downloaded',
      'error',
    ] as const) {
      engine.on(name, (...args: unknown[]) => events.push([name, args[0]]));
    }

    emit({ type: 'checking' });
    emit({
      releaseDate: '2026-09-12T00:00:00Z',
      releaseNotes: 'notes',
      type: 'update-available',
      version: '1.1.0',
    });
    emit({ type: 'update-downloaded', version: '1.1.0' });
    emit({ type: 'update-not-available' });
    emit({ message: 'boom', type: 'error' });

    expect(events[0]).toEqual(['checking-for-update', undefined]);
    expect(events[1]).toEqual([
      'update-available',
      expect.objectContaining({
        releaseDate: '2026-09-12T00:00:00Z',
        releaseNotes: 'notes',
        version: '1.1.0',
      }),
    ]);
    expect(events[2]).toEqual([
      'update-downloaded',
      expect.objectContaining({ releaseNotes: 'notes', version: '1.1.0' }),
    ]);
    expect(events[3]).toEqual([
      'update-not-available',
      expect.objectContaining({ version: '1.0.0' }),
    ]);
    expect(events[4]).toEqual(['error', expect.any(Error)]);
    expect((events[4][1] as Error).message).toBe('boom');
  });

  it('reports download progress only for the download phase and restarts on fallback', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
    const { emit, engine } = setup();
    const progress: unknown[] = [];
    engine.on('download-progress', (info) => progress.push(info));

    emit({ type: 'download-progress', phase: 'download', percent: 0, transferred: 0 });
    vi.setSystemTime(new Date('2026-09-12T00:00:02Z'));
    emit({
      type: 'download-progress',
      phase: 'download',
      percent: 50,
      total: 200,
      transferred: 100,
    });
    emit({ type: 'download-progress', phase: 'apply', percent: 30 });
    emit({
      type: 'download-progress',
      phase: 'download',
      percent: 0,
      transferred: 0,
      fallback: true,
    });

    expect(progress).toHaveLength(3);
    expect(progress[1]).toEqual({
      bytesPerSecond: 50,
      percent: 50,
      total: 200,
      transferred: 100,
    });
    expect(progress[2]).toMatchObject({ percent: 0, transferred: 0 });
    vi.useRealTimers();
  });
});

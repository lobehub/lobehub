import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fixture,
  loadManager,
  rendererOnly,
  serveLatest,
  setupOtaFixture,
  teardownOtaFixture,
} from './testUtils';

const { electronMock, loggerMock } = vi.hoisted(() => ({
  electronMock: {
    app: {
      getPath: vi.fn(),
      on: vi.fn(),
      quit: vi.fn(),
      relaunch: vi.fn(),
      releaseSingleInstanceLock: vi.fn(),
    },
    BrowserWindow: { getAllWindows: vi.fn(() => []) },
    net: { fetch: vi.fn(), isOnline: vi.fn(() => true) },
  },
  loggerMock: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/utils/logger', () => ({ createLogger: () => loggerMock }));
vi.mock('electron', () => electronMock);
vi.mock('@/modules/updater/configs', () => ({
  BUILD_CHANNEL: 'stable',
  UPDATE_CHANNEL: 'stable',
  UPDATE_SERVER_URL: 'https://updates.test/stable',
  coerceStoredUpdateChannel: (channel?: string) => (channel === 'canary' ? 'canary' : 'stable'),
}));

beforeEach(() => {
  vi.clearAllMocks();
  setupOtaFixture();
  electronMock.app.getPath.mockReturnValue(fixture.userDataDir);
});

afterEach(teardownOtaFixture);

describe('CoreUpdateManager applied notice', () => {
  it('retains a healthy hot update and its active renderer version for late subscribers', async () => {
    serveLatest(rendererOnly('1.0.1', 1));
    const { app, manager } = await loadManager();
    await manager.checkForUpdates();
    expect(manager.getStatus().appliedVersion).toBeNull();
    manager.applyStagedNow();
    manager.handleBootPing('loaded');
    expect(manager.getStatus().appliedVersion).toBeNull();
    expect(app.browserManager.broadcastToAllWindows).not.toHaveBeenCalledWith(
      'coreUpdateApplied',
      expect.anything(),
    );
    manager.handleBootPing('mounted');
    expect(manager.getStatus()).toMatchObject({
      appliedVersion: '1.0.1',
      running: '1.0.1',
      staged: null,
    });
    expect(app.browserManager.broadcastToAllWindows).toHaveBeenCalledWith(
      'coreUpdateApplied',
      '1.0.1',
    );
    manager.handleBootPing('mounted');
    expect(
      app.browserManager.broadcastToAllWindows.mock.calls.filter(
        ([event]) => event === 'coreUpdateApplied',
      ),
    ).toHaveLength(1);
  });

  it('does not announce a failed hot update as completed', async () => {
    vi.useFakeTimers();
    try {
      serveLatest(rendererOnly('1.0.1', 1));
      const { app, manager } = await loadManager();
      await manager.checkForUpdates();
      manager.applyStagedNow();
      await vi.advanceTimersByTimeAsync(60_000);
      manager.handleBootPing('mounted');
      expect(manager.getStatus().appliedVersion).toBeNull();
      expect(app.browserManager.broadcastToAllWindows).not.toHaveBeenCalledWith(
        'coreUpdateApplied',
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops reporting a dismissed notice and still announces the next hot update', async () => {
    serveLatest(rendererOnly('1.0.1', 1));
    const { manager } = await loadManager();
    await manager.checkForUpdates();
    manager.applyStagedNow();
    manager.handleBootPing('mounted');
    expect(manager.getStatus().appliedVersion).toBe('1.0.1');

    manager.dismissAppliedNotice();
    expect(manager.getStatus().appliedVersion).toBeNull();

    serveLatest(rendererOnly('1.0.2', 2));
    await manager.checkForUpdates();
    manager.applyStagedNow();
    manager.handleBootPing('mounted');
    expect(manager.getStatus().appliedVersion).toBe('1.0.2');
  });
});

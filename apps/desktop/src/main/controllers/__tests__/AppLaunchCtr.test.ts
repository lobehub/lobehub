import { realpathSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import AppLaunchController from '../AppLaunchCtr';

const broadcastToWindow = vi.fn();

// The launch path is canonicalized (`/tmp` is a symlink on macOS), so assert
// against the resolved form rather than the spelling the caller used.
const TMP = realpathSync('/tmp');

const fakeApp = {
  browserManager: { broadcastToWindow },
} as unknown as App;

const createController = () => new AppLaunchController(fakeApp);

describe('AppLaunchCtr', () => {
  beforeEach(() => {
    broadcastToWindow.mockReset();
  });

  it('should hold a directory that arrives before the renderer subscribes', () => {
    const controller = createController();

    // Cold start: the target is drained right after the window exists, while
    // the renderer has not mounted its listeners yet.
    void controller.handleOpenPath({ path: '/tmp' });

    expect(broadcastToWindow).not.toHaveBeenCalled();
  });

  it('should replay the held directory once the renderer is ready', async () => {
    const controller = createController();
    await controller.handleOpenPath({ newWindow: true, path: '/tmp' });

    const replayed = await controller.clientReady();

    expect(replayed).toBe(true);
    expect(broadcastToWindow).toHaveBeenCalledWith('app', 'openDirectory', {
      newWindow: true,
      path: TMP,
    });
  });

  it('should replay only the latest held directory', async () => {
    const controller = createController();
    await controller.handleOpenPath({ path: '/tmp' });
    await controller.handleOpenPath({ path: '/' });

    await controller.clientReady();

    expect(broadcastToWindow).toHaveBeenCalledTimes(1);
    expect(broadcastToWindow).toHaveBeenCalledWith('app', 'openDirectory', {
      newWindow: false,
      path: '/',
    });
  });

  it('should deliver immediately once the renderer is ready', async () => {
    const controller = createController();
    await controller.clientReady();
    broadcastToWindow.mockReset();

    await controller.handleOpenPath({ path: '/tmp' });

    expect(broadcastToWindow).toHaveBeenCalledWith('app', 'openDirectory', {
      newWindow: false,
      path: TMP,
    });
  });

  it('should report nothing to replay when no launch is waiting', async () => {
    const controller = createController();

    expect(await controller.clientReady()).toBe(false);
    expect(broadcastToWindow).not.toHaveBeenCalled();
  });

  it('should reject a path that is not a directory', async () => {
    const controller = createController();

    expect(await controller.handleOpenPath({ path: '/does/not/exist' })).toBe(false);
    expect(await controller.handleOpenPath({ path: undefined })).toBe(false);
    expect(broadcastToWindow).not.toHaveBeenCalled();
  });
});

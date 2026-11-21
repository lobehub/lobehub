import { createPathTarget } from '@/utils/launchTarget';
import { createLogger } from '@/utils/logger';

import { ControllerModule, createProtocolHandler, IpcMethod } from '.';

const logger = createLogger('controllers:AppLaunchCtr');

const protocolHandler = createProtocolHandler('open');

interface OpenDirectoryPayload {
  newWindow: boolean;
  path: string;
}

interface OpenPathParams {
  newWindow?: boolean;
  path?: unknown;
}

/**
 * Turns an external launch into a renderer instruction.
 *
 * The validation deliberately happens here rather than in the CLI: argv, a
 * deep link and a Finder drop all reach this point, and a path that no longer
 * exists (a deleted worktree, a stale alias in `~/.zshrc`) must fail loudly in
 * one place instead of opening an empty workspace from three.
 *
 * Delivery is handshaked, not fire-and-forget. On a cold start the target is
 * drained as soon as the window exists, long before React has mounted the
 * navigation bridge, and `webContents.send` into a page with no subscriber
 * leaves no trace — the launch would simply be lost. Targets that arrive
 * before the renderer reports readiness are therefore held and replayed, and
 * the latest one wins because a launch describes a destination, not a queue.
 */
export default class AppLaunchController extends ControllerModule {
  static override readonly groupName = 'appLaunch';

  private pending: null | OpenDirectoryPayload = null;
  private rendererReady = false;

  @protocolHandler('path')
  public async handleOpenPath(params: OpenPathParams): Promise<boolean> {
    const requested = typeof params?.path === 'string' ? params.path : '';
    const target = createPathTarget(requested);

    if (!target || target.kind !== 'path') {
      logger.warn(`🚀 [AppLaunch] Ignoring non-directory open request: ${requested || '(empty)'}`);
      return false;
    }

    if (!this.app?.browserManager) {
      logger.error('🚀 [AppLaunch] App or browserManager not available');
      return false;
    }

    const payload: OpenDirectoryPayload = {
      newWindow: params?.newWindow === true,
      path: target.path,
    };

    if (!this.rendererReady) {
      logger.debug(`🚀 [AppLaunch] Renderer not ready yet, holding directory:`, payload);
      this.pending = payload;
      return true;
    }

    this.broadcast(payload);
    return true;
  }

  /**
   * The renderer has mounted its launch listeners. Replay anything that
   * arrived while it was still loading.
   */
  @IpcMethod()
  public async clientReady(): Promise<boolean> {
    this.rendererReady = true;
    logger.debug('🚀 [AppLaunch] Renderer reported ready');

    const pending = this.pending;
    this.pending = null;
    if (!pending) return false;

    logger.debug(`🚀 [AppLaunch] Renderer ready, replaying held directory:`, pending);
    this.broadcast(pending);
    return true;
  }

  private broadcast(payload: OpenDirectoryPayload) {
    logger.debug(`🚀 [AppLaunch] Broadcasting openDirectory:`, payload);
    this.app.browserManager.broadcastToWindow('app', 'openDirectory', payload);
  }
}

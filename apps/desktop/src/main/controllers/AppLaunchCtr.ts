import { createPathTarget } from '@/utils/launchTarget';
import { createLogger } from '@/utils/logger';

import { ControllerModule, createProtocolHandler } from '.';

const logger = createLogger('controllers:AppLaunchCtr');

const protocolHandler = createProtocolHandler('open');

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
 */
export default class AppLaunchController extends ControllerModule {
  static override readonly groupName = 'appLaunch';

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

    const payload = { newWindow: params?.newWindow === true, path: target.path };
    logger.debug(`🚀 [AppLaunch] Broadcasting openDirectory:`, payload);

    this.app.browserManager.broadcastToWindow('app', 'openDirectory', payload);
    return true;
  }
}

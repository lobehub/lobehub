import { createTerminalDeps, TerminalSessionManager } from '@lobechat/device-control/terminal';

import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:terminal:remote');

let remoteTerminals: TerminalSessionManager | undefined;

/**
 * Device-control terminal handlers, so a browser or another desktop can open a
 * shell on this machine over the device gateway — the same RPCs `lh connect`
 * serves. One manager per process: the personal and every workspace-share
 * connection dispatch through it, so they all reach the same sessions.
 *
 * Kept apart from the in-app terminal's `PtySessionManager`: that one pushes
 * output to this app's renderer over IPC, while a remote reader polls a
 * buffer with a cursor.
 */
export const getRemoteTerminalDeps = () => {
  remoteTerminals ??= new TerminalSessionManager({
    client: 'desktop',
    loadPty: () => import('@lydell/node-pty'),
    logger: { warn: (message) => logger.warn(message) },
  });
  return createTerminalDeps(remoteTerminals);
};

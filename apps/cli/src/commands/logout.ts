import type { Command } from 'commander';

import { clearCredentials } from '../auth/credentials';
import { stopDaemon } from '../daemon/manager';
import { saveActiveWorkspace } from '../settings';
import { log } from '../utils/logger';

export function registerLogoutCommand(program: Command) {
  program
    .command('logout')
    .description('Log out and remove stored credentials')
    .action(() => {
      // Tear down the connect daemon first — otherwise it keeps the device
      // online on the gateway with the cached token even after credentials are
      // gone, leaving the machine remotely driveable past "logout".
      const stopped = stopDaemon();
      if (stopped) {
        log.info('Disconnected device daemon.');
      }

      // The workspace scope belongs to the account that set it. Leaving it behind
      // means the next login — possibly a different account — starts out claiming
      // a workspace it may have no membership in.
      saveActiveWorkspace(null);

      const removed = clearCredentials();
      if (removed) {
        log.info('Logged out. Credentials removed.');
      } else {
        log.info('No credentials found. Already logged out.');
      }
    });
}

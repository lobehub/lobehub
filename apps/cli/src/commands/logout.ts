import type { Command } from 'commander';

import { clearCredentials } from '../auth/credentials';
import { log } from '../utils/logger';

export function registerLogoutCommand(program: Command) {
  program
    .command('logout')
    .description('Log out and remove stored credentials')
    .action(() => {
      const removed = clearCredentials();
      if (removed) {
        log.info('Logged out. Credentials removed.');
      } else {
        log.info('No credentials found. Already logged out.');
      }
    });
}

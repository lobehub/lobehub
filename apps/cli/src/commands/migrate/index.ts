import type { Command } from 'commander';

import { registerOpenClawMigration } from './openclaw';

export function registerMigrateCommand(program: Command) {
  const migrate = program
    .command('migrate')
    .description('Migrate data from external tools (OpenClaw, ChatGPT, Claude, etc.)');

  registerOpenClawMigration(migrate);
}

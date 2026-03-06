import { Command } from 'commander';

import { registerConnectCommand } from './commands/connect';
import { registerDocCommand } from './commands/doc';
import { registerLoginCommand } from './commands/login';
import { registerLogoutCommand } from './commands/logout';
import { registerStatusCommand } from './commands/status';

const program = new Command();

program
  .name('lh')
  .description('LobeHub CLI - manage and connect to LobeHub services')
  .version('0.1.0');

registerLoginCommand(program);
registerLogoutCommand(program);
registerConnectCommand(program);
registerStatusCommand(program);
registerDocCommand(program);

program.parse();

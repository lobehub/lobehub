import { Command } from 'commander';

import { registerAgentCommand } from './commands/agent';
import { registerConfigCommand } from './commands/config';
import { registerConnectCommand } from './commands/connect';
import { registerDocCommand } from './commands/doc';
import { registerFileCommand } from './commands/file';
import { registerGenerateCommand } from './commands/generate';
import { registerKbCommand } from './commands/kb';
import { registerLoginCommand } from './commands/login';
import { registerLogoutCommand } from './commands/logout';
import { registerMemoryCommand } from './commands/memory';
import { registerMessageCommand } from './commands/message';
import { registerModelCommand } from './commands/model';
import { registerPluginCommand } from './commands/plugin';
import { registerProviderCommand } from './commands/provider';
import { registerSearchCommand } from './commands/search';
import { registerSkillCommand } from './commands/skill';
import { registerStatusCommand } from './commands/status';
import { registerTopicCommand } from './commands/topic';

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
registerSearchCommand(program);
registerKbCommand(program);
registerMemoryCommand(program);
registerAgentCommand(program);
registerGenerateCommand(program);
registerFileCommand(program);
registerSkillCommand(program);
registerTopicCommand(program);
registerMessageCommand(program);
registerModelCommand(program);
registerProviderCommand(program);
registerPluginCommand(program);
registerConfigCommand(program);

program.parse();

import { createRequire } from 'node:module';

import { Command } from 'commander';

import { registerAgentCommand } from './commands/agent';
import { registerAgentGroupCommand } from './commands/agent-group';
import { registerBotCommand } from './commands/bot';
import { registerCompletionCommand } from './commands/completion';
import { registerConfigCommand } from './commands/config';
import { registerConnectCommand } from './commands/connect';
import { registerCronCommand } from './commands/cron';
import { registerDeviceCommand } from './commands/device';
import { registerDocCommand } from './commands/doc';
import { registerEvalCommand } from './commands/eval';
import { registerFileCommand } from './commands/file';
import { registerGenerateCommand } from './commands/generate';
import { registerKbCommand } from './commands/kb';
import { registerLoginCommand } from './commands/login';
import { registerLogoutCommand } from './commands/logout';
import { registerManCommand } from './commands/man';
import { registerMemoryCommand } from './commands/memory';
import { registerMessageCommand } from './commands/message';
import { registerMigrateCommand } from './commands/migrate';
import { registerModelCommand } from './commands/model';
import { registerNotifyCommand } from './commands/notify';
import { registerPluginCommand } from './commands/plugin';
import { registerProviderCommand } from './commands/provider';
import { registerSearchCommand } from './commands/search';
import { registerSessionGroupCommand } from './commands/session-group';
import { registerSkillCommand } from './commands/skill';
import { registerStatusCommand } from './commands/status';
import { registerTaskCommand } from './commands/task';
import { registerThreadCommand } from './commands/thread';
import { registerTopicCommand } from './commands/topic';
import { registerUserCommand } from './commands/user';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

export function createProgram() {
  const program = new Command();

  program
    .name('lh')
    .description('LobeHub CLI - manage and connect to LobeHub services')
    .version(version);

  registerLoginCommand(program);
  registerLogoutCommand(program);
  registerCompletionCommand(program);
  registerManCommand(program);
  registerConnectCommand(program);
  registerDeviceCommand(program);
  registerStatusCommand(program);
  registerDocCommand(program);
  registerSearchCommand(program);
  registerKbCommand(program);
  registerMemoryCommand(program);
  registerAgentCommand(program);
  registerAgentGroupCommand(program);
  registerBotCommand(program);
  registerCronCommand(program);
  registerGenerateCommand(program);
  registerFileCommand(program);
  registerSkillCommand(program);
  registerSessionGroupCommand(program);
  registerTaskCommand(program);
  registerThreadCommand(program);
  registerTopicCommand(program);
  registerMessageCommand(program);
  registerModelCommand(program);
  registerNotifyCommand(program);
  registerProviderCommand(program);
  registerPluginCommand(program);
  registerUserCommand(program);
  registerConfigCommand(program);
  registerEvalCommand(program);
  registerMigrateCommand(program);

  return program;
}

export { version as cliVersion };

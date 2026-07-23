import { Command } from 'commander';

import { registerAgentCommand } from './commands/agent';
import { registerAgentGroupCommand } from './commands/agent-group';
import { registerAgentSignalCommand } from './commands/agent-signal';
import { registerBotCommand } from './commands/bot';
import { registerCompletionCommand } from './commands/completion';
import { registerConfigCommand } from './commands/config';
import { registerConnectCommand } from './commands/connect';
import { registerDeviceCommand } from './commands/device';
import { registerDocCommand } from './commands/doc';
import { registerEvalCommand } from './commands/eval';
import { registerFileCommand } from './commands/file';
import { registerGenerateCommand } from './commands/generate';
import { registerHeteroCommand } from './commands/hetero';
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
import { registerUpdateCommand } from './commands/update';
import { registerUserCommand } from './commands/user';
import { registerVerifyCommand } from './commands/verify';
import { registerAcceptanceCommands } from './commands/verifyAcceptance';
import { cliVersion } from './pkg';
import { executeToolCall } from './tools';

export function createProgram() {
  const program = new Command();

  program
    .name('lh')
    .description('LobeHub CLI - manage and connect to LobeHub services')
    .version(cliVersion);

  const internalToolWorker = program
    .command('tool-worker')
    .description('Internal command for isolated tool execution')
    .requiredOption('--api <name>')
    .requiredOption('--args-b64 <value>')
    .option('--timeout <ms>')
    .action(async (options: { api: string; argsB64: string; timeout?: string }) => {
      const argsStr = Buffer.from(options.argsB64, 'base64').toString('utf8');
      const parsedTimeout =
        options.timeout && options.timeout.trim()
          ? Number.parseInt(options.timeout, 10)
          : undefined;
      const result = await executeToolCall(
        options.api,
        argsStr,
        Number.isFinite(parsedTimeout) ? parsedTimeout : undefined,
      );
      process.stdout.write(JSON.stringify(result));
    });
  internalToolWorker.helpInformation = () => '';

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
  registerAgentSignalCommand(program);
  registerBotCommand(program);
  registerGenerateCommand(program);
  registerFileCommand(program);
  registerHeteroCommand(program);
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
  registerVerifyCommand(program);
  // First-class review-loop entry: `lh acceptance list|view|feedback|accept|reject`.
  registerAcceptanceCommands(program);
  registerConfigCommand(program);
  registerEvalCommand(program);
  registerMigrateCommand(program);
  registerUpdateCommand(program);

  return program;
}

export { cliPackageName, cliVersion } from './pkg';

import type { Command } from 'commander';

import { resolveServerUrl } from '../../settings';
import { runGitCredential } from './credential';

export function registerGitCommand(program: Command) {
  const git = program.command('git').description('Git integration for LobeHub runs');

  git
    .command('credential <action>')
    .description("Git credential helper that hands out the run requester's GitHub credential")
    .action(async (action: string) => {
      process.exitCode = await runGitCredential(action, {
        serverUrl: resolveServerUrl(),
        stderr: process.stderr,
        stdin: process.stdin,
        stdout: process.stdout,
      });
    });
}

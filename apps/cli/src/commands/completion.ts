import type { Command } from 'commander';

import { CLI_COMPLETION_CWORD_ENV } from '../constants/identity';
import {
  getCompletionCandidates,
  parseCompletionWordIndex,
  renderCompletionScript,
  resolveCompletionShell,
} from '../utils/completion';

export function registerCompletionCommand(program: Command) {
  program
    .command('completion [shell]')
    .description('Output shell completion script')
    .action((shell?: string) => {
      console.log(renderCompletionScript(resolveCompletionShell(shell)));
    });

  program
    .command('__complete', { hidden: true })
    .allowUnknownOption()
    .argument('[words...]')
    .action((words: string[] = []) => {
      const currentWordIndex = parseCompletionWordIndex(
        process.env[CLI_COMPLETION_CWORD_ENV],
        words,
      );
      const candidates = getCompletionCandidates(program, words, currentWordIndex);

      for (const candidate of candidates) {
        console.log(candidate);
      }
    });
}

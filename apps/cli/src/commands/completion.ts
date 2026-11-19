import type { Command } from 'commander';

import { listWorkspaces } from '../api/workspaceRef';
import { getValidToken } from '../auth/refresh';
import { pickAuthSource } from '../auth/source';
import { CLI_COMPLETION_CWORD_ENV } from '../constants/identity';
import {
  getCompletionCandidates,
  isCompletingWorkspaceValue,
  parseCompletionWordIndex,
  renderCompletionScript,
  resolveCompletionShell,
} from '../utils/completion';

const WORKSPACE_LOOKUP_TIMEOUT_MS = 2000;

/**
 * Workspace slugs for `--workspace <TAB>`. A completion must stay silent and
 * quick, so no login, a failed request or a slow server all yield no candidates;
 * `getTrpcClient` would otherwise print its login error into the prompt.
 */
const listWorkspaceCandidates = async (currentWord: string): Promise<string[]> => {
  // The pending request keeps the event loop alive, and the shell waits on us.
  const watchdog = setTimeout(() => process.exit(0), WORKSPACE_LOOKUP_TIMEOUT_MS);
  try {
    if (pickAuthSource().kind === 'stored' && (await getValidToken()).status !== 'ok') return [];

    const workspaces = await listWorkspaces();
    return workspaces.map((w) => w.slug).filter((slug) => slug.startsWith(currentWord));
  } catch {
    return [];
  } finally {
    clearTimeout(watchdog);
  }
};

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
    .action(async (words: string[] = []) => {
      const currentWordIndex = parseCompletionWordIndex(
        process.env[CLI_COMPLETION_CWORD_ENV],
        words,
      );
      const candidates = isCompletingWorkspaceValue(program, words, currentWordIndex)
        ? await listWorkspaceCandidates(words[currentWordIndex] ?? '')
        : getCompletionCandidates(program, words, currentWordIndex);

      for (const candidate of candidates) {
        console.log(candidate);
      }
    });
}

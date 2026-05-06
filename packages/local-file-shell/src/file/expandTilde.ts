import os from 'node:os';
import path from 'node:path';

/**
 * Expand a leading `~` (or `~/...`, `~\...`) to the user's home directory.
 * Pass-through for any other input — the shell normally handles `~` expansion,
 * but Node fs APIs do not, so paths supplied by the LLM (or pasted by users)
 * would otherwise fail with ENOENT.
 */
export const expandTilde = (input: string | undefined): string | undefined => {
  if (!input) return input;
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
};

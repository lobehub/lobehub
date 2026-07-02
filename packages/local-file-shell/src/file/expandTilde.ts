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

/**
 * Resolve a filesystem path for Node fs APIs: first expand a leading `~`, then
 * anchor a still-relative path to `cwd` — the device-bound working directory.
 *
 * Absolute paths pass through untouched. When `cwd` is absent the behavior is
 * identical to {@link expandTilde}, so callers that don't carry a working
 * directory (e.g. desktop client-mode today) keep resolving relative paths
 * against the process cwd and nothing regresses. Without this, a relative path
 * supplied by the model resolves against the daemon's `process.cwd()` (= `/`
 * for a Finder/Dock-launched app) instead of the user's bound directory.
 */
export const resolveAgainstCwd = (
  input: string | undefined,
  cwd?: string,
): string | undefined => {
  const expanded = expandTilde(input);
  if (!expanded || !cwd) return expanded;
  return path.isAbsolute(expanded) ? expanded : path.join(cwd, expanded);
};

import path from 'node:path';

import { getCliWrapperDir } from './generateCliWrapper';

/**
 * Absolute path of the `lh` this desktop build ships, for an agent whose shell
 * resolves an older global install first. Login shells (`zsh -lc`, which Codex
 * uses) re-run the user's profile and can move a pnpm/npm bin dir back in front
 * of the PATH entry below, so the path alone is the reliable handle.
 */
export const LOBEHUB_CLI_ENV = 'LOBEHUB_CLI';

const CLI_WRAPPER_NAME = process.platform === 'win32' ? 'lh.cmd' : 'lh';

export const getEmbeddedCliPath = (wrapperDir: string = getCliWrapperDir()): string =>
  path.join(wrapperDir, CLI_WRAPPER_NAME);

/**
 * The env key holding the search path. Windows env names are case-insensitive and
 * `process.env` usually spells it `Path`, which a plain-object copy keeps; writing
 * `PATH` beside it would make the child keep only one of the two. An explicit
 * `PATH` (e.g. a resolved login-shell PATH set by the caller) wins.
 */
const findPathKey = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string => {
  if (platform !== 'win32' || 'PATH' in env) return 'PATH';
  return Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
};

/**
 * Spawn env for an external agent: the bundled CLI's wrapper dir goes to the
 * front of PATH (the app only appends it, so a stale global `lh` wins) and
 * `LOBEHUB_CLI` names the wrapper itself.
 */
export const withEmbeddedCliEnv = (
  env: NodeJS.ProcessEnv,
  wrapperDir: string = getCliWrapperDir(),
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv => {
  const delimiter = platform === 'win32' ? ';' : ':';
  const pathKey = findPathKey(env, platform);
  const rest = (env[pathKey] ?? '').split(delimiter).filter((dir) => dir && dir !== wrapperDir);
  const next: NodeJS.ProcessEnv = { ...env, [LOBEHUB_CLI_ENV]: getEmbeddedCliPath(wrapperDir) };
  // Drop other spellings so the child cannot pick a stale duplicate over the prefixed one.
  if (platform === 'win32') {
    for (const key of Object.keys(next)) {
      if (key !== pathKey && key.toUpperCase() === 'PATH') delete next[key];
    }
  }
  next[pathKey] = [wrapperDir, ...rest].join(delimiter);
  return next;
};

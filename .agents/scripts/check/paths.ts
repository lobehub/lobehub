import { access } from 'node:fs/promises';
import path from 'node:path';

import type { CheckConfig, RepoMount } from './types';

/**
 * Active config, set once by `runCli` before any IO helper runs. A module
 * singleton (instead of threading config through every call) keeps the IO
 * layer signatures small; the pure routing helpers take their inputs
 * explicitly and stay independently testable.
 */
let config: CheckConfig | undefined;

export const setConfig = (next: CheckConfig) => {
  config = next;
};

export const getConfig = (): CheckConfig => {
  if (!config) throw new Error('check engine not configured — call runCli with a CheckConfig');
  return config;
};

export const rootDir = () => getConfig().rootDir;

/** Absolute directory of a mounted repo. */
export const mountDir = (mount: RepoMount) => path.join(rootDir(), mount.dir);

export const exists = (target: string): Promise<boolean> =>
  access(target).then(
    () => true,
    () => false,
  );

/** Whether a root-relative path exists on disk. */
export const existsInRepo = (relPath: string): Promise<boolean> =>
  exists(path.join(rootDir(), relPath));

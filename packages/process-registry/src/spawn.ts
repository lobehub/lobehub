import { type ChildProcess, spawn, type SpawnOptions } from 'node:child_process';

import { getProcessContext } from './context';
import type { ProcessRegistry } from './registry';
import type { ProcessTags } from './types';

export interface RegistrySpawnOptions extends SpawnOptions {
  /** Explicit tags. Merged over ALS context (explicit wins). */
  tags?: Partial<ProcessTags> & { ownerModule: string };
}

export interface RegistrySpawnDeps {
  registry: ProcessRegistry;
}

/**
 * spawn() wrapper that registers the child with a ProcessRegistry and applies
 * unix-safe defaults for tree-killing (detached: true so a pgid exists).
 *
 * Tags are resolved by merging the AsyncLocalStorage context with
 * `options.tags` (explicit wins). `ownerModule` MUST be provided explicitly —
 * we never infer it from context to avoid silent mis-attribution.
 */
export function registrySpawn(
  command: string,
  args: readonly string[],
  options: RegistrySpawnOptions,
  deps: RegistrySpawnDeps,
): ChildProcess {
  const { tags: explicitTags, ...spawnOpts } = options;
  if (!explicitTags?.ownerModule) {
    throw new Error('registrySpawn: options.tags.ownerModule is required');
  }

  const merged: ProcessTags = {
    ...getProcessContext(),
    ...explicitTags,
    ownerModule: explicitTags.ownerModule,
  };

  const finalOpts: SpawnOptions = {
    detached: process.platform !== 'win32',
    ...spawnOpts,
  };

  const child = spawn(command, [...args], finalOpts);
  deps.registry.register({
    args: [...args],
    command,
    process: child,
    tags: merged,
  });
  return child;
}

import { AsyncLocalStorage } from 'node:async_hooks';

import type { ProcessTags } from './types';

const storage = new AsyncLocalStorage<Partial<ProcessTags>>();

/**
 * Run `fn` with a set of process tags attached to the async context.
 * Nested calls merge tags — inner keys win.
 */
export function runWithProcessContext<T>(tags: Partial<ProcessTags>, fn: () => T): T {
  const parent = storage.getStore() ?? {};
  return storage.run({ ...parent, ...tags }, fn);
}

export function getProcessContext(): Partial<ProcessTags> {
  return storage.getStore() ?? {};
}

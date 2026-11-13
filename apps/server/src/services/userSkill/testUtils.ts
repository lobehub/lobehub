import { vi } from 'vitest';

import { skillStorage } from './storage';

/**
 * Stands in for the object storage under user skills: what a publish writes
 * reads back. Spied on `skillStorage`, so `vi.restoreAllMocks()` undoes it.
 */
export const mockSkillStorage = () => {
  const objects = new Map<string, Uint8Array>();
  vi.spyOn(skillStorage, 'write').mockImplementation(async (_owner, key, bytes) => {
    objects.set(key, bytes);
  });
  vi.spyOn(skillStorage, 'read').mockImplementation(async (_owner, key) => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error(`No object at ${key}`);
    return bytes;
  });
  return objects;
};

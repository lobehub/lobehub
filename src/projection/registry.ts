import { createMemoryProjectionPersistence } from './persistence/memoryAdapter';
import type { ProjectionPersistence } from './persistence/types';

let activePersistence = createMemoryProjectionPersistence();

/** Stable forwarding facade retained by the store and test seams. */
export const projectionRepository: ProjectionPersistence = {
  clearScope: (scope) => activePersistence.clearScope(scope),
  commit: (scope, commit) => activePersistence.commit(scope, commit),
  hydrate: (scope, request) => activePersistence.hydrate(scope, request),
};

export const registerProjectionPersistence = (persistence: ProjectionPersistence): (() => void) => {
  const previous = activePersistence;
  activePersistence = persistence;

  return () => {
    if (activePersistence === persistence) activePersistence = previous;
  };
};

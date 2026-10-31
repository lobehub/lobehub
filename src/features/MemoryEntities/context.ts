import { createContext, use } from 'react';

import { type EntityDataApi } from './useEntityData';

export const EntityDataContext = createContext<EntityDataApi | null>(null);

export const useEntityDataContext = () => {
  const value = use(EntityDataContext);
  if (!value) throw new Error('useEntityDataContext must be used inside MemoryEntities');
  return value;
};

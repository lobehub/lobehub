import { StateCreator } from 'zustand';
import { MemoryContext, MemoryContextMap } from '@/types/memory';
import { ContextSlice } from './store';

export interface ContextActions {
  /**
   * Add a new context entry.
   */
  addContext: (entry: MemoryContext) => void;
  /**
   * Update an existing context entry.
   */
  updateContext: (id: string, updates: Partial<MemoryContext>) => void;
  /**
   * Delete a context entry.
   */
  deleteContext: (id: string) => void;
  /**
   * Get all context entries as an array.
   */
  getContexts: () => MemoryContext[];
}

export const createContextActions: StateCreator<
  ContextSlice,
  [],
  [],
  ContextActions
> = (set, get) => ({
  addContext: (entry) => {
    set((state) => ({
      contexts: { ...state.contexts, [entry.id]: entry },
    }));
  },
  updateContext: (id, updates) => {
    const current = get().contexts[id];
    if (!current) return;
    const updated = { ...current, ...updates };
    set((state) => ({
      contexts: { ...state.contexts, [id]: updated },
    }));
  },
  deleteContext: (id) => {
    set((state) => {
      const { [id]: _, ...rest } = state.contexts;
      return { contexts: rest };
    });
  },
  getContexts: () => Object.values(get().contexts),
});

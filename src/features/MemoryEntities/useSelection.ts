import { useQueryState } from '@/hooks/useQueryParam';

import { useEntityTrailStore } from './store';

/**
 * Same param the memory detail portal links to (`getMemoryDetailPath`), so "open in memory"
 * from a chat lands on that context.
 */
export const CONTEXT_ID_PARAM = 'contextId';

export const useSelection = () => {
  const [selectedId, setSelectedId] = useQueryState(CONTEXT_ID_PARAM, { clearOnDefault: true });
  const history = useEntityTrailStore((s) => s.history);
  const { clear, pop, push } = useEntityTrailStore.getState();

  return {
    back: () => {
      const previous = pop();
      if (previous) setSelectedId(previous);
    },
    /**
     * Keeps the page on screen when it was only shown as the default pick: changing its status
     * would otherwise make another context the default and swap the page mid-action.
     */
    ensureSelected: (id: string) => {
      if (!selectedId) setSelectedId(id);
    },
    history,
    /** Follows a link from the current page; keeps the way back. */
    open: (id: string) => {
      if (selectedId && selectedId !== id) push(selectedId);
      setSelectedId(id);
    },
    /** Picks a page from the list; starts a fresh trail. */
    select: (id?: string) => {
      clear();
      setSelectedId(id ?? null);
    },
    selectedId: selectedId || undefined,
  };
};

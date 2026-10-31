import { CONTEXT_ID_PARAM } from '@/features/MemoryEntities/useSelection';
import { useQueryState } from '@/hooks/useQueryParam';

/** `?view=legacy` shows the per-topic contexts consolidation did not file. */
export const VIEW_PARAM = 'view';
export const LEGACY_VIEW = 'legacy';

/**
 * Which story is open lives in the URL under the same param the memory detail portal links to,
 * so "open in memory" from a chat and reloads land on the same page.
 */
export const useStoryView = () => {
  const [contextId, setContextId] = useQueryState(CONTEXT_ID_PARAM, { clearOnDefault: true });
  const [view, setView] = useQueryState(VIEW_PARAM, { clearOnDefault: true });

  return {
    closeLegacy: () => setView(null),
    contextId: contextId || undefined,
    legacy: view === LEGACY_VIEW,
    open: (id: string) => setContextId(id),
    /** Opened from the wall, where no story is selected. */
    openLegacy: () => setView(LEGACY_VIEW),
    openWall: () => setContextId(null),
  };
};

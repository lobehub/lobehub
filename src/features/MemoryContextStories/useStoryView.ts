import { useSearchParams } from 'react-router';

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
  const [, setSearchParams] = useSearchParams();

  return {
    closeLegacy: () => setView(null),
    contextId: contextId || undefined,
    legacy: view === LEGACY_VIEW,
    /** One update: the legacy page reads `?contextId=` itself, so the story pick goes too. */
    openLegacy: () =>
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete(CONTEXT_ID_PARAM);
        next.set(VIEW_PARAM, LEGACY_VIEW);
        return next;
      }),
    select: (id: string) => setContextId(id),
  };
};

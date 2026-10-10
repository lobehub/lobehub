import { knowledgeBaseSelectors, useKnowledgeBaseStore } from '@/store/library';
import type { KnowledgeBaseItem } from '@/types/knowledgeBase';

export interface KnowledgeBaseItemState {
  data: KnowledgeBaseItem | undefined;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
}

/**
 * Resolve one KB by id for the route layout / permission page. The value is
 * read from the `knowledgeBaseItem` replica view (never from the fetch result);
 * the hook only starts the hydrate + network sync and reports its flags.
 *
 * `isLoading` stays true until the first sync settles, so the route keeps its
 * loading skeleton instead of flashing a "not found" before the fetch lands.
 */
export const useKnowledgeBaseItem = (id: string): KnowledgeBaseItemState => {
  const useFetchKnowledgeBaseItem = useKnowledgeBaseStore((s) => s.useFetchKnowledgeBaseItem);
  const sync = useFetchKnowledgeBaseItem(id);
  const data = useKnowledgeBaseStore(knowledgeBaseSelectors.getKnowledgeBaseById(id));

  const active = !!id;
  const isLoading =
    active && data === undefined && (sync.error ? false : !sync.isHydrated || sync.isValidating);

  return { data, error: sync.error, isLoading, mutate: sync.revalidate };
};

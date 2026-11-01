import { useNotebookStore } from '@/store/notebook';
import { notebookSelectors } from '@/store/notebook/selectors';

/**
 * Fetch notebook documents for the current topic.
 *
 * The documents are read from the topic's local-first replica (`notebookMap`),
 * so a previously visited topic paints at once; the hook only starts the
 * hydrate + network sync and derives the loading flag.
 */
export const useFetchNotebookDocuments = (topicId?: string) => {
  const useFetchDocuments = useNotebookStore((s) => s.useFetchDocuments);
  const documents = useNotebookStore((s) => notebookSelectors.getDocumentsByTopicId(topicId)(s));

  const { isHydrated, isValidating } = useFetchDocuments(topicId);

  // Show the spinner only while nothing can be painted yet: before the
  // persisted row is read, or on an empty topic that is still fetching. A
  // hydrated topic with rows paints at once instead of flashing the spinner.
  const isLoading = !!topicId && (!isHydrated || (documents.length === 0 && isValidating));

  return {
    documents,
    isLoading,
    topicId,
  };
};

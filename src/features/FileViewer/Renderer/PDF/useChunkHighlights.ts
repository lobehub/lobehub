import { lambdaQuery } from '@/libs/trpc/client';

/**
 * Retrieval chunks overlaid on a PDF's pages. The chunk query is scoped to the
 * viewer's own files, so a host previewing a file it does not own (a public
 * source such as a share visitor's file Work) disables it instead of issuing a
 * request that can only come back empty or rejected.
 */
export const useChunkHighlights = (fileId: string, enabled: boolean) => {
  const { data } = lambdaQuery.chunk.getChunksByFileId.useInfiniteQuery(
    { id: fileId },
    { enabled, getNextPageParam: (lastPage) => lastPage.nextCursor },
  );

  return data?.pages.flatMap((page) => page.items) || [];
};

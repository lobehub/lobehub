import type { CollectionWorkItem } from '@lobechat/types';
import { useMemo } from 'react';

import { useWorkStore, workActions, workSelectors } from '@/store/work';

/**
 * The images a collection viewer shows: the ones the caller passed, else those of
 * the Work's latest version (readable by its owner only).
 *
 * The versions come from the Work version replica (`work:versions`), the one the
 * sidebar timeline reads, so the run-end and Work-change refreshes that
 * revalidate it also update an open viewer after the agent replaces the images.
 */
export const useCollectionItems = ({
  items,
  workId,
}: {
  items?: CollectionWorkItem[];
  workId?: string;
}) => {
  const params = useMemo(() => (items || !workId ? null : { workId }), [items, workId]);
  const { error, revalidate } = workActions.useFetchWorkVersions(params, {
    revalidateOnFocus: false,
  });
  // Versions come newest first.
  const versions = useWorkStore((s) =>
    params ? workSelectors.workVersions(params.workId)(s) : undefined,
  );
  const latest = versions ? (versions[0]?.metadata?.collection?.items ?? []) : undefined;

  return {
    error: items || latest ? undefined : error,
    images: items ?? latest,
    isLoading: Boolean(params) && latest === undefined && !error,
    retry: () => {
      void revalidate();
    },
  };
};

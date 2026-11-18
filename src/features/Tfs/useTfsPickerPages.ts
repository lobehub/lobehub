import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { TfsQuery } from '@/services/tfs';
import { useTfsData } from '@/store/tfs/action';
import { tfsQueryKey } from '@/store/tfs/projection';
import { useTfsStore } from '@/store/tfs/store';

/** Keep cursor history locally; page contents stay in the scoped replica cache. */
export const useTfsPickerPages = (
  query: Omit<TfsQuery, 'cursor' | 'kind'> & { kind: 'projects' | 'branches' },
  enabled: boolean,
) => {
  const scope = tfsQueryKey(query);
  const [pagination, setPagination] = useState({
    scope,
    cursors: [undefined] as (string | undefined)[],
  });
  const cursors = pagination.scope === scope ? pagination.cursors : [undefined];
  if (pagination.scope !== scope) setPagination({ scope, cursors });
  const cursor = cursors.at(-1);
  const current = useTfsData({ ...query, cursor }, enabled);
  const pages = useTfsStore(
    useShallow((state) =>
      cursors.map((value) => state.data[tfsQueryKey({ ...query, cursor: value })]),
    ),
  );
  const items = [
    ...new Map(
      pages.flatMap(
        (page) =>
          (query.kind === 'projects' ? page?.projects?.items : page?.branches?.items)?.map(
            (item) => [item.name, item] as const,
          ) ?? [],
      ),
    ).values(),
  ];
  const next = current.data?.[query.kind]?.next;

  return {
    ...current,
    items,
    next,
    loadMore: () => {
      if (next && !current.isValidating && !cursors.includes(next))
        setPagination({ scope, cursors: [...cursors, next] });
    },
  };
};

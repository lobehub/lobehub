import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { TfsQuery } from '@/services/tfs';
import { useTfsData } from '@/store/tfs/action';
import { tfsQueryKey } from '@/store/tfs/projection';
import { useTfsStore } from '@/store/tfs/store';

export interface TfsPickerPagesOptions {
  /**
   * 自动把所有分页拉完。分支选择用它，避免用户反复点“加载更多分支”。
   */
  autoLoadAll?: boolean;
  /** 自动加载的页数上限，防止超大仓库拖慢界面。 */
  maxAutoPages?: number;
}

/** Keep cursor history locally; page contents stay in the scoped replica cache. */
export const useTfsPickerPages = (
  query: Omit<TfsQuery, 'cursor' | 'kind'> & { kind: 'projects' | 'branches' },
  enabled: boolean,
  options: TfsPickerPagesOptions = {},
) => {
  const { autoLoadAll = false, maxAutoPages = 20 } = options;
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
  const truncated = autoLoadAll && Boolean(next) && cursors.length >= maxAutoPages;

  const advance = useCallback(() => {
    if (next && !current.isValidating && !cursors.includes(next) && cursors.length < maxAutoPages) {
      setPagination({ scope, cursors: [...cursors, next] });
    }
  }, [cursors, current.isValidating, maxAutoPages, next, scope]);

  // 分支列表默认自动拉完所有分页；命中页数上限时保留“加载更多”作为兜底。
  useEffect(() => {
    if (!autoLoadAll || !enabled || truncated) return;

    advance();
  }, [advance, autoLoadAll, enabled, truncated]);

  return {
    ...current,
    items,
    next,
    truncated,
    loadMore: advance,
  };
};

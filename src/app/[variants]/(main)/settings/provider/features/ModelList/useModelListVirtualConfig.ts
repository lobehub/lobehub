'use client';

import { useMemo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';

interface UseModelListVirtualConfigOptions {
  itemGap?: number;
}

export const useModelListVirtualConfig = (
  length: number,
  { itemGap: customItemGap }: UseModelListVirtualConfigOptions = {},
) => {
  const isMobile = useIsMobile();
  const itemGap = customItemGap ?? 0;
  const itemHeight = isMobile ? 92 : 68;
  const maxVisibleCount = isMobile ? 8 : 12;
  const visibleCount = Math.min(length || 1, maxVisibleCount);
  const maxHeight = isMobile ? 480 : 650;
  const listHeight = visibleCount * (itemHeight + itemGap) - itemGap;
  const virtualListHeight = Math.min(listHeight, maxHeight);

  const increaseViewportBy = useMemo(
    () => ({ bottom: itemHeight * 6, top: itemHeight * 6 }),
    [itemHeight],
  );
  //   const overscan = useMemo(() => itemHeight * 6, [itemHeight]);
  const itemSize = itemHeight + itemGap;

  return {
    increaseViewportBy,
    itemGap,
    itemHeight,
    itemSize,
    overscan: 0,
    virtualListHeight,
  };
};

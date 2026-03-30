import { useMemo } from 'react';

import type { ViewMode } from '@/routes/(main)/resource/features/store/initialState';

interface UseMasonryViewStateOptions {
  dataLength: number;
  isLoading: boolean;
  isNavigating: boolean;
  isValidating: boolean;
  viewMode: ViewMode;
}

export const useMasonryViewState = ({
  dataLength,
  isLoading,
  isNavigating,
  isValidating,
  viewMode: _viewMode,
}: UseMasonryViewStateOptions) => {
  const showSkeleton = useMemo(
    () => (isLoading && dataLength === 0) || (isNavigating && isValidating),
    [dataLength, isLoading, isNavigating, isValidating],
  );

  const isMasonryReady = !showSkeleton;

  return {
    isMasonryReady,
    showSkeleton,
  };
};

interface LibraryListAsyncStateInput<T> {
  data?: T[];
  isLoading?: boolean;
  isValidating?: boolean;
}

export const getLibraryListAsyncState = <T>({
  data,
  isLoading = false,
  isValidating = false,
}: LibraryListAsyncStateInput<T>) => {
  const hasData = (data?.length ?? 0) > 0;
  const showSkeleton = isLoading || (isValidating && !hasData);

  return {
    boundaryData: showSkeleton ? undefined : data,
    isEmpty: data?.length === 0,
    isLoading: showSkeleton,
  };
};

import type { ReactNode } from 'react';

import AsyncBoundary from '@/components/AsyncBoundary';

import { isMemoryListPending } from './isMemoryListPending';

interface MemoryListBoundaryProps {
  children: ReactNode;
  data: unknown;
  error?: unknown;
  isInitialized: boolean;
  isLoading: boolean;
  isResetting?: boolean;
  loading: ReactNode;
  onRetry: () => void;
}

/**
 * Keeps memory list loading, error, and retry behavior consistent. A reset deliberately hides
 * cached data because the store list has already been cleared for the new query.
 */
export const MemoryListBoundary = ({
  children,
  data,
  error,
  isInitialized,
  isLoading,
  isResetting,
  loading,
  onRetry,
}: MemoryListBoundaryProps) => {
  const pending = isMemoryListPending({
    error,
    initialized: isInitialized,
    loading: isLoading,
    resetting: isResetting,
  });

  return (
    <AsyncBoundary
      data={isResetting || error ? undefined : data}
      error={error}
      errorVariant={'page'}
      isLoading={pending}
      loading={loading}
      onRetry={onRetry}
    >
      {children}
    </AsyncBoundary>
  );
};

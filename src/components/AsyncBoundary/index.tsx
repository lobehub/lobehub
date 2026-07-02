'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { memo, type ReactNode } from 'react';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import AsyncError, { type AsyncErrorVariant } from '../AsyncError';

/**
 * The four-state gate every data surface owes its user: loading / error / empty /
 * data. It exists because the codebase's fetch conventions only ever modeled
 * loading + success — the SWR `error` was returned but discarded, so a failed
 * fetch fell through to a permanent skeleton, a fake onboarding empty, or a
 * confident `$0`. `AsyncBoundary` reads `error` **before** the empty branch and
 * renders the right state, once, so no call site hand-rolls the precedence.
 *
 * The error is already in hand at the call site — SWR returns it. Migrating a
 * surface is two mechanical steps: capture `{ error, mutate }` from the hook and
 * wrap the render in `<AsyncBoundary error={error} onRetry={mutate} …>`.
 *
 * Precedence (only when nothing has successfully loaded, so a background
 * revalidate that errors doesn't blow away already-shown content):
 *   error → loading → empty → children
 */
export interface AsyncBoundaryProps {
  children: ReactNode;
  /** Node for the empty state (onboarding CTA / no-match). Required to show empty. */
  empty?: ReactNode;
  /** The thrown error from SWR / the query. Read before the empty branch. */
  error?: unknown;
  /** The `AsyncError` variant to render on failure. Default `block`. */
  errorVariant?: AsyncErrorVariant;
  /**
   * Whether any usable data is already loaded. Defaults to `!isEmpty`. Pass
   * explicitly when "empty" and "has data" aren't strict opposites (e.g. a
   * merged fetched + static list, where `length > 0` isn't proof of success).
   */
  hasData?: boolean;
  /** No records to show (`length === 0`). Gate it on `!error` at the call site. */
  isEmpty?: boolean;
  /** First-load in flight. */
  isLoading?: boolean;
  /** Custom loading node (a shape-matched skeleton). Defaults to a centered loader. */
  loading?: ReactNode;
  /** Retry the same request (SWR `mutate`). Wired into the error state's Retry. */
  onRetry?: () => void;
}

const AsyncBoundary = memo<AsyncBoundaryProps>(
  ({
    children,
    error,
    errorVariant = 'block',
    empty,
    hasData,
    isEmpty = false,
    isLoading = false,
    loading,
    onRetry,
  }) => {
    // Do we already have content worth keeping on screen? A background refresh
    // that errors should not replace loaded data with a full-surface error.
    const dataPresent = hasData ?? !isEmpty;

    // 1. Failure with nothing to show → the error state (reason + Retry).
    if (error && !dataPresent) {
      return <AsyncError error={error} variant={errorVariant} onRetry={onRetry} />;
    }

    // 2. First load in flight → loading (caller's skeleton, else a centered loader).
    if (isLoading && !dataPresent) {
      return (
        loading ?? (
          <Center flex={1} padding={48} width={'100%'}>
            <NeuralNetworkLoading size={24} />
          </Center>
        )
      );
    }

    // 3. Genuinely empty (only reached when !error) → the purpose-built empty page.
    if (isEmpty) return <Flexbox width={'100%'}>{empty}</Flexbox>;

    // 4. Data.
    return <>{children}</>;
  },
);

AsyncBoundary.displayName = 'AsyncBoundary';

export default AsyncBoundary;

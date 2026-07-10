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
 * Everything the boundary needs is already in hand at the call site — SWR
 * returns it. Migrating a surface is mechanical pass-through: capture
 * `{ data, error, isLoading, mutate }` from the hook and wrap the render in
 * `<AsyncBoundary data={data} error={error} isLoading={isLoading} onRetry={mutate} …>`.
 *
 * Precedence (only before the fetch has ever settled — `data !== undefined` —
 * so a background revalidate that errors doesn't blow away settled content,
 * including a settled *empty* list):
 *   loading → error → empty → children
 *
 * Loading is read before error so a Retry in flight (SWR keeps the previous
 * error until the revalidation settles) shows the skeleton instead of a frozen
 * error block with a still-clickable Retry.
 */
export interface AsyncBoundaryProps {
  children: ReactNode;
  /**
   * The fetch result, passed through untouched (SWR's `data`). `undefined`
   * means the fetch has never settled successfully — the boundary's "nothing
   * worth keeping on screen" signal. Deliberately not derived from `isEmpty`
   * (a settled empty list HAS loaded) nor from `isLoading` (a failed first
   * load is neither loading nor settled). For a merged fetched + static
   * surface, pass the fetched slice. Required (though `undefined` is a valid
   * value) so no call site forgets the settled signal and silently regresses
   * into error-blows-away-content.
   */
  data: unknown;
  /** Node for the empty state (onboarding CTA / no-match). Required to show empty. */
  empty?: ReactNode;
  /** The thrown error from SWR / the query. Read before the empty branch. */
  error?: unknown;
  /** The `AsyncError` variant to render on failure. Default `block`. */
  errorVariant?: AsyncErrorVariant;
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
    data,
    error,
    errorVariant = 'block',
    empty,
    isEmpty = false,
    isLoading = false,
    loading,
    onRetry,
  }) => {
    // Has the fetch ever settled successfully? A settled result — even an
    // empty list — is content worth keeping: a background refresh that errors
    // must not replace it with a full-surface error.
    const hasSettled = data !== undefined;

    // 1. Request in flight with nothing to show → loading (caller's skeleton,
    //    else a centered loader). Checked before error: after a failed first
    //    load SWR keeps `error` set while a Retry revalidates, and the user
    //    needs in-progress feedback, not the stale error block.
    if (isLoading && !hasSettled) {
      return (
        loading ?? (
          <Center flex={1} padding={48} width={'100%'}>
            <NeuralNetworkLoading size={24} />
          </Center>
        )
      );
    }

    // 2. Failure with nothing to show → the error state (reason + Retry).
    if (error && !hasSettled) {
      return <AsyncError error={error} variant={errorVariant} onRetry={onRetry} />;
    }

    // 3. Genuinely empty (only reached when !error) → the purpose-built empty page.
    //    Mirror the loading branch's frame (`flex={1}` + `height='100%'`) so the
    //    empty node inherits a resolved height and can center vertically inside
    //    bounded parents. Unbounded parents fall through to auto height per spec,
    //    keeping intrinsic-height empty states unaffected.
    if (isEmpty)
      return (
        <Flexbox flex={1} height={'100%'} width={'100%'}>
          {empty}
        </Flexbox>
      );

    // 4. Data.
    return <>{children}</>;
  },
);

AsyncBoundary.displayName = 'AsyncBoundary';

export default AsyncBoundary;

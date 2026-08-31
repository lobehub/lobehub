'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useSWRConfig } from 'swr';

import AsyncError, { type AsyncErrorVariant } from '@/components/AsyncError';

interface BoundaryProps {
  children: ReactNode;
  onReset: () => void;
  variant: AsyncErrorVariant;
}

interface BoundaryState {
  error?: Error;
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = {};

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[SuspenseRouteBoundary]', error, info.componentStack);
  }

  retry = () => {
    this.setState({ error: undefined });
    this.props.onReset();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return <AsyncError error={error} variant={this.props.variant} onRetry={this.retry} />;
  }
}

/**
 * Pairs with the route skeleton: loading is the route's Suspense fallback,
 * failure is this boundary's Retry.
 *
 * Under `suspense`, SWR reports a failed fetch by throwing, so the four-state
 * gate `AsyncBoundary` used to run at the call site has to move above the
 * suspending component. Without it one failed request takes the whole route to
 * the router's error page and the user loses the Retry that used to sit inside
 * the surface. Reset revalidates every key so the retry re-runs the fetch that
 * threw instead of replaying its cached rejection.
 */
const SuspenseRouteBoundary = ({
  children,
  variant = 'page',
}: {
  children: ReactNode;
  variant?: AsyncErrorVariant;
}) => {
  const { mutate } = useSWRConfig();

  return (
    <Boundary variant={variant} onReset={() => mutate(() => true, undefined, { revalidate: true })}>
      {children}
    </Boundary>
  );
};

export default SuspenseRouteBoundary;

'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { SWRConfig } from 'swr';

import AsyncError, { type AsyncErrorVariant } from '@/components/AsyncError';

import {
  resetOnLocationChange,
  type RouteBoundaryState,
  routeResetKey,
} from './resetOnLocationChange';
import { useRouteRetry } from './useRouteRetry';

interface BoundaryProps {
  children: ReactNode;
  onReset: () => void;
  resetKey: string;
  variant: AsyncErrorVariant;
}

class Boundary extends Component<BoundaryProps, RouteBoundaryState> {
  state: RouteBoundaryState = { resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: RouteBoundaryState) {
    return resetOnLocationChange(props.resetKey, state);
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
 * the surface.
 *
 * Two things the class boundary alone gets wrong, both because it is mounted in
 * a *persistent* area layout that outlives the route under it:
 *
 * - Its error state survives navigation, so a failure on one route keeps
 *   covering the healthy sibling the user moves to. `resetKey` clears it as the
 *   location changes.
 * - Reset has to clear the SWR entry that threw, but the error carries no key,
 *   so the naive fix is to invalidate the whole cache — which refetches every
 *   mounted consumer in the app for one route's Retry. `onError` records the
 *   keys that actually failed and reset revalidates only those.
 */
const SuspenseRouteBoundary = ({
  children,
  variant = 'page',
}: {
  children: ReactNode;
  variant?: AsyncErrorVariant;
}) => {
  const { onError, onReset } = useRouteRetry();
  const { pathname, search } = useLocation();

  return (
    <SWRConfig value={{ onError }}>
      <Boundary resetKey={routeResetKey(pathname, search)} variant={variant} onReset={onReset}>
        {children}
      </Boundary>
    </SWRConfig>
  );
};

export default SuspenseRouteBoundary;

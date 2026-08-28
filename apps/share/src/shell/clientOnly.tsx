'use client';

import { type ComponentType, lazy, type ReactNode, Suspense, useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

const useHydrated = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

/**
 * Keeps a subtree out of the server render. The SSR build resolves `*.client`
 * modules to an empty stub (see `share-client-only-stub` in vite.config.rr.mts),
 * so the gated graph never reaches the worker bundle at all.
 *
 * `fallback` is what the document ships and what hydration matches; pass the
 * static half of the view there so the client takeover is not a visible swap.
 */
export const clientOnly = <P extends object>(
  importFn: () => Promise<{ default: ComponentType<P> }>,
) => {
  const Component = lazy(importFn);

  return function ClientOnly({ fallback, ...props }: P & { fallback?: ReactNode }) {
    const hydrated = useHydrated();

    if (!hydrated) return fallback ?? null;

    return (
      <Suspense fallback={fallback ?? null}>
        <Component {...(props as P)} />
      </Suspense>
    );
  };
};

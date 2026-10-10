'use client';

import { createContext, type ReactNode, use, useMemo } from 'react';

import type { AcceptanceBundle } from '@/services/verify';

/** A bundle an authorized server fetch already returned, tied to its acceptance id. */
export interface AcceptanceInitialBundleValue {
  acceptanceId: string;
  bundle: AcceptanceBundle;
}

const AcceptanceInitialBundleContext = createContext<AcceptanceInitialBundleValue | null>(null);

/**
 * Carry a loader-fetched bundle to the render tree as request-local data.
 *
 * The Workbench SSR loader already holds an authorized bundle before the first
 * render, but the replica store is a module singleton shared by every request
 * the server handles: writing the bundle into it at render time would leak one
 * request's authorized entry into a later (or concurrent) request whose loader
 * returned `null`. A React context is created fresh per render — per request on
 * the server — and the same value reaches both the server render and the client
 * hydration, so the two trees agree and no shared store is mutated.
 *
 * It is a fallback only: as soon as the live replica holds a value, that value
 * wins (see {@link useAcceptanceBundle}).
 */
export const AcceptanceInitialBundle = ({
  acceptanceId,
  bundle,
  children,
}: {
  acceptanceId: string;
  bundle: AcceptanceBundle | null | undefined;
  children: ReactNode;
}) => {
  const value = useMemo(() => (bundle ? { acceptanceId, bundle } : null), [acceptanceId, bundle]);
  return <AcceptanceInitialBundleContext value={value}>{children}</AcceptanceInitialBundleContext>;
};

/** The loader-provided bundle for this render, if any (`null` in the main app). */
export const useAcceptanceInitialBundle = () => use(AcceptanceInitialBundleContext);

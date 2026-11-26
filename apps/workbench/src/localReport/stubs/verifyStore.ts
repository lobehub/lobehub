import type { AcceptanceCommentList } from '@lobechat/types';
import { useSyncExternalStore } from 'react';

import type { AcceptanceBundle } from '@/services/verify';

import { getLocalReport } from '../localReportData';

/**
 * The page data, typed as the hosted bundle. This assignment is the contract
 * check between the local assembler and the viewer: when the server's bundle
 * gains a field the viewer reads, the local one has to produce it too.
 */
const readBundleMap = (): Record<string, AcceptanceBundle> => {
  try {
    const report = getLocalReport();
    const bundle: AcceptanceBundle = report.bundle();
    return { [report.acceptanceId]: bundle };
  } catch {
    // The entry renders the reason; the viewer just sees nothing to show.
    return {};
  }
};

/** The discussion holds each round's proposal, read from the page data. */
const readCommentMap = (): Record<string, AcceptanceCommentList> => {
  try {
    const report = getLocalReport();
    return { [report.acceptanceId]: report.comments() };
  } catch {
    return {};
  }
};

const sync = {
  error: undefined,
  isHydrated: true,
  isValidating: false,
  revalidate: async () => undefined,
};

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const useFetchAcceptanceBundle = (
  _acceptanceId?: string | null,
  _options?: { enabled?: boolean; refreshInterval?: number },
) => sync;

const useFetchAcceptanceComments = (_acceptanceId?: string | null) => sync;

const refreshAcceptanceBundle = async (_acceptanceId: string) => {
  state = { ...state, acceptanceBundleMap: readBundleMap() };
  for (const listener of listeners) listener();
};

const emptyState = {
  acceptanceBundleMap: readBundleMap(),
  acceptanceCommentMap: readCommentMap(),
  refreshAcceptanceBundle,
  useFetchAcceptanceBundle,
  useFetchAcceptanceComments,
};

type VerifyState = typeof emptyState;

let state = emptyState;

/**
 * `@/store/verify` for the offline report: the bundle map holds the one local
 * acceptance, recomputed whenever the reviewer records a decision.
 */
export const useVerifyStore = <T>(selector: (current: VerifyState) => T): T =>
  useSyncExternalStore(subscribe, () => selector(state));

useVerifyStore.getState = () => state;

const acceptanceComments = (acceptanceId?: string | null) => (s: VerifyState) =>
  acceptanceId ? s.acceptanceCommentMap[acceptanceId] : undefined;

// The page data is the whole discussion, so what it holds is already confirmed.
const isAcceptanceCommentsConfirmed = (_acceptanceId?: string | null) => (_s: VerifyState) => true;

/** The selectors the offline viewer reads; each mirrors `@/store/verify`'s. */
export const verifySelectors = {
  acceptanceComments,
  isAcceptanceCommentsConfirmed,
};

try {
  getLocalReport().subscribe(() => void refreshAcceptanceBundle(getLocalReport().acceptanceId));
} catch {
  // No data: nothing will change either.
}

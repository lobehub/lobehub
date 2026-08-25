import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

// False during SSR and the hydration render, true after mount — for
// viewer-timezone-dependent output that must not be part of hydrated HTML.
export const useIsHydrated = () =>
  useSyncExternalStore(noopSubscribe, getSnapshot, getServerSnapshot);

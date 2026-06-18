import { useSyncExternalStore } from 'react';

let appReady = false;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const getAppReady = () => appReady;

export const setAppReady = (ready: boolean) => {
  if (appReady === ready) return;

  appReady = ready;
  emit();
};

export const subscribeAppReady = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useAppReady = () => useSyncExternalStore(subscribeAppReady, getAppReady, getAppReady);

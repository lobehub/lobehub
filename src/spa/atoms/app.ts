import { useSyncExternalStore } from 'react';

let appReady = false;
let appPainted = false;
let postRenderReady = false;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const getAppReady = () => appReady;
export const getAppPainted = () => appPainted;
export const getPostRenderReady = () => postRenderReady;

export const setAppReady = (ready: boolean) => {
  if (appReady === ready) return;

  appReady = ready;
  emit();
};

export const setAppPainted = (painted: boolean) => {
  if (appPainted === painted) return;

  appPainted = painted;
  emit();
};

export const setPostRenderReady = (ready: boolean) => {
  if (postRenderReady === ready) return;

  postRenderReady = ready;
  emit();
};

export const subscribeAppReady = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useAppReady = () => useSyncExternalStore(subscribeAppReady, getAppReady, getAppReady);

export const useAppPainted = () =>
  useSyncExternalStore(subscribeAppReady, getAppPainted, getAppPainted);

export const usePostRenderReady = () =>
  useSyncExternalStore(subscribeAppReady, getPostRenderReady, getPostRenderReady);

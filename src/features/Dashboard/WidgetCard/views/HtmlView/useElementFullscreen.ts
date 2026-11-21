import { type RefObject, useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
};

/**
 * Native full screen for one element: whether it is the full-screen element
 * now, and a toggle. `supported` is false where the page may not go full
 * screen (an embedding frame without `allowfullscreen`, some mobile browsers).
 */
export const useElementFullscreen = (ref: RefObject<HTMLElement | null>) => {
  const isFullscreen = useSyncExternalStore(
    subscribe,
    () => !!ref.current && document.fullscreenElement === ref.current,
    () => false,
  );

  const toggle = async () => {
    if (isFullscreen) {
      await document.exitFullscreen();
      return;
    }
    await ref.current?.requestFullscreen();
  };

  return { isFullscreen, supported: !!document.fullscreenEnabled, toggle };
};

export const attachDictationLifecycle = (handlers: {
  onInterrupted: () => void;
  onOffline: () => void;
}): (() => void) | undefined => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const handleHidden = () => {
    if (document.visibilityState === 'hidden') handlers.onInterrupted();
  };
  document.addEventListener('visibilitychange', handleHidden);
  window.addEventListener('offline', handlers.onOffline);
  navigator.mediaDevices?.addEventListener?.('devicechange', handlers.onInterrupted);
  return () => {
    document.removeEventListener('visibilitychange', handleHidden);
    window.removeEventListener('offline', handlers.onOffline);
    navigator.mediaDevices?.removeEventListener?.('devicechange', handlers.onInterrupted);
  };
};

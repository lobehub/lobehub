const preferenceKey = 'first-compression-hint-dismissed';
const changed = 'first-compression-hint-changed';
let dismissedInMemory = false;

export function isFirstCompressionDismissed() {
  try {
    return dismissedInMemory || localStorage.getItem(preferenceKey) === '1';
  } catch {
    return dismissedInMemory;
  }
}

export function dismissFirstCompression() {
  dismissedInMemory = true;
  try {
    localStorage.setItem(preferenceKey, '1');
  } catch {
    // The preference remains available for the current session.
  }
  window.dispatchEvent(new Event(changed));
}

export function shouldShowFirstCompression(dismissed: boolean, isFirstGroup: boolean) {
  return !dismissed && isFirstGroup;
}

export function subscribeFirstCompression(listener: () => void) {
  window.addEventListener(changed, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener('storage', listener);
  };
}

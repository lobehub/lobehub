// Dependency-free: the boot skeleton (entry chunk) reads this before any store.

/**
 * The boot skeleton paints before the per-user `im_layout` flag is known, so
 * the last layout the app rendered is remembered here and mirrored.
 */
export const IM_LAYOUT_HINT_KEY = 'LOBE_IM_LAYOUT';

export const readImLayoutHint = (): boolean => {
  try {
    return localStorage.getItem(IM_LAYOUT_HINT_KEY) === '1';
  } catch {
    return false;
  }
};

export const writeImLayoutHint = (enabled: boolean) => {
  try {
    if (enabled) localStorage.setItem(IM_LAYOUT_HINT_KEY, '1');
    else localStorage.removeItem(IM_LAYOUT_HINT_KEY);
  } catch {
    // Storage may be unavailable (private mode); the skeleton then shows the default.
  }
};

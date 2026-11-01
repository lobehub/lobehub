const RATE_STORAGE_KEY = 'acceptance-video-rate';

// A reviewer who watches at 1.5× wants the next recording at 1.5× too.
export const readStoredRate = () => {
  try {
    const value = Number(localStorage.getItem(RATE_STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : 1;
  } catch {
    return 1;
  }
};

export const storeRate = (rate: number) => {
  try {
    localStorage.setItem(RATE_STORAGE_KEY, String(rate));
  } catch {
    /* private mode — the rate simply resets next time */
  }
};

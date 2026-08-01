import { aicoEnv } from '@/envs/aico';

export type FxRateSource = 'live' | 'env';

export interface TomanPerUsdRate {
  rate: number;
  source: FxRateSource;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const LIVE_FX_URL = 'https://open.er-api.com/v6/latest/USD';
const FETCH_TIMEOUT_MS = 4000;

let cached: { expiresAt: number; rate: number } | null = null;

/** Allows tests to swap the live-fetch implementation without network access. */
let fetchLiveRateImpl = async (): Promise<number> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(LIVE_FX_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`FX API ${res.status}`);
    const data = (await res.json()) as { rates?: Record<string, number> };
    const rialPerUsd = data.rates?.IRR;
    if (!rialPerUsd || !Number.isFinite(rialPerUsd) || rialPerUsd <= 0) {
      throw new Error('FX API missing IRR rate');
    }
    // 1 Toman = 10 Iranian Rials.
    return rialPerUsd / 10;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Toman-per-USD rate for topup conversion. Tries a live lookup (15min cache),
 * falling back to `AICO_TOMAN_PER_USD` on any failure — USD wallet balances
 * are the source of truth, so a stale/fallback FX rate never blocks a topup.
 */
export const getTomanPerUsd = async (): Promise<TomanPerUsdRate> => {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return { rate: cached.rate, source: 'live' };
  }

  try {
    const rate = await fetchLiveRateImpl();
    cached = { expiresAt: now + CACHE_TTL_MS, rate };
    return { rate, source: 'live' };
  } catch {
    return { rate: aicoEnv.AICO_TOMAN_PER_USD, source: 'env' };
  }
};

export const __setFxLiveFetchImplForTests = (impl: () => Promise<number>) => {
  fetchLiveRateImpl = impl;
};

export const __resetFxCacheForTests = () => {
  cached = null;
};

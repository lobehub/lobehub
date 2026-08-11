import { aicoEnv } from '@/envs/aico';

export type FxRateSource = 'admin' | 'live' | 'env';

export interface TomanPerUsdRate {
  /** Positive integer toman per 1 USD — safe for BigInt / integer money math. */
  rate: number;
  source: FxRateSource;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const LIVE_FX_URL = 'https://open.er-api.com/v6/latest/USD';
const FETCH_TIMEOUT_MS = 4000;

let cached: { expiresAt: number; rate: number } | null = null;

/**
 * Live FX feeds return floats (e.g. IRR/10 → 126510.0632387). Integer money
 * math and `BigInt(rate)` require a positive integer toman-per-USD.
 */
export const toIntegerTomanPerUsd = (rate: number): number => {
  const rounded = Math.round(rate);
  if (!Number.isFinite(rounded) || rounded <= 0) {
    throw new Error('INVALID_FX_RATE');
  }
  return rounded;
};

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
 * Toman-per-USD rate for topup / credit conversion.
 *
 * Priority:
 * 1. Platform admin rate (`platform_fx_config`) when provided by the caller
 * 2. Live lookup (15min cache) — legacy fallback when no admin rate is wired
 * 3. `AICO_TOMAN_PER_USD` env on any live failure
 *
 * Always returns an integer rate so callers can safely use BigInt / FX math.
 */
export const getTomanPerUsd = async (adminRate?: number | null): Promise<TomanPerUsdRate> => {
  if (adminRate != null && Number.isFinite(adminRate) && adminRate > 0) {
    return { rate: toIntegerTomanPerUsd(adminRate), source: 'admin' };
  }

  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return { rate: cached.rate, source: 'live' };
  }

  try {
    const rate = toIntegerTomanPerUsd(await fetchLiveRateImpl());
    cached = { expiresAt: now + CACHE_TTL_MS, rate };
    return { rate, source: 'live' };
  } catch {
    return { rate: toIntegerTomanPerUsd(aicoEnv.AICO_TOMAN_PER_USD), source: 'env' };
  }
};

export const __setFxLiveFetchImplForTests = (impl: () => Promise<number>) => {
  fetchLiveRateImpl = impl;
};

export const __resetFxCacheForTests = () => {
  cached = null;
};

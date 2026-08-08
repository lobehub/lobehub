'use client';

import { useSyncExternalStore } from 'react';

/** Persisted client-only unlock for the funds-blocked composer cue. */
export const FUNDS_BLOCKED_SOUND_STORAGE_KEY = 'AICO_POOL_VADE';

/** Query param: `?poolVade=1` enables, `?poolVade=0` disables (then stripped). */
export const FUNDS_BLOCKED_SOUND_URL_PARAM = 'poolVade';

/** Type this sequence anywhere to toggle the cue on/off. */
export const FUNDS_BLOCKED_SOUND_TOGGLE_CODE = 'poolvade';

const CODE_RESET_MS = 2000;

let memoryEnabled = false;
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((listener) => listener());
};

const readEnabled = (): boolean => {
  if (typeof localStorage === 'undefined') return memoryEnabled;

  try {
    return localStorage.getItem(FUNDS_BLOCKED_SOUND_STORAGE_KEY) === '1';
  } catch {
    return memoryEnabled;
  }
};

export const isFundsBlockedSoundEnabled = (): boolean => readEnabled();

export const setFundsBlockedSoundEnabled = (enabled: boolean): void => {
  memoryEnabled = enabled;

  if (typeof localStorage !== 'undefined') {
    try {
      if (enabled) localStorage.setItem(FUNDS_BLOCKED_SOUND_STORAGE_KEY, '1');
      else localStorage.removeItem(FUNDS_BLOCKED_SOUND_STORAGE_KEY);
    } catch {
      // In-memory flag still applies for the session when storage is blocked.
    }
  }

  notify();
};

export const toggleFundsBlockedSoundEnabled = (): boolean => {
  const next = !readEnabled();
  setFundsBlockedSoundEnabled(next);
  return next;
};

const parseUrlFlag = (raw: string | null): boolean | null => {
  if (raw === null) return null;
  const value = raw.trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'on' || value === 'enable') return true;
  if (value === '0' || value === 'false' || value === 'off' || value === 'disable') return false;
  return null;
};

/**
 * If the page URL carries `poolVade`, persist enable/disable and remove the
 * param from the address bar so the secret does not linger in history shares.
 */
export const syncFundsBlockedSoundFlagFromUrl = (
  search = typeof location !== 'undefined' ? location.search : '',
): boolean | null => {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(search);
  if (!params.has(FUNDS_BLOCKED_SOUND_URL_PARAM)) return null;

  const parsed = parseUrlFlag(params.get(FUNDS_BLOCKED_SOUND_URL_PARAM));
  if (parsed !== null) setFundsBlockedSoundEnabled(parsed);

  params.delete(FUNDS_BLOCKED_SOUND_URL_PARAM);
  const nextSearch = params.toString();
  const nextUrl = `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}${location.hash}`;
  window.history.replaceState(window.history.state, '', nextUrl);

  return parsed;
};

export interface FundsBlockedSoundCodeSequence {
  buffer: string;
  lastKeyAt: number;
}

export const INITIAL_FUNDS_BLOCKED_SOUND_CODE_SEQUENCE: FundsBlockedSoundCodeSequence = {
  buffer: '',
  lastKeyAt: 0,
};

/**
 * Advances a typed-code buffer toward {@link FUNDS_BLOCKED_SOUND_TOGGLE_CODE}.
 * Completing the code toggles the persisted flag.
 */
export const advanceFundsBlockedSoundCodeSequence = (
  sequence: FundsBlockedSoundCodeSequence,
  key: string,
  now: number,
): { completed: boolean; sequence: FundsBlockedSoundCodeSequence } => {
  if (key.length !== 1 || !/[a-z]/i.test(key)) {
    return { completed: false, sequence: INITIAL_FUNDS_BLOCKED_SOUND_CODE_SEQUENCE };
  }

  const letter = key.toLowerCase();
  const buffer = now - sequence.lastKeyAt <= CODE_RESET_MS ? sequence.buffer + letter : letter;
  const next: FundsBlockedSoundCodeSequence = { buffer, lastKeyAt: now };

  if (!FUNDS_BLOCKED_SOUND_TOGGLE_CODE.startsWith(buffer)) {
    // Allow the typed letter to start a fresh attempt (e.g. mistype mid-code).
    if (FUNDS_BLOCKED_SOUND_TOGGLE_CODE.startsWith(letter)) {
      return { completed: false, sequence: { buffer: letter, lastKeyAt: now } };
    }
    return { completed: false, sequence: INITIAL_FUNDS_BLOCKED_SOUND_CODE_SEQUENCE };
  }

  if (buffer === FUNDS_BLOCKED_SOUND_TOGGLE_CODE) {
    toggleFundsBlockedSoundEnabled();
    return { completed: true, sequence: INITIAL_FUNDS_BLOCKED_SOUND_CODE_SEQUENCE };
  }

  return { completed: false, sequence: next };
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key === FUNDS_BLOCKED_SOUND_STORAGE_KEY) listener();
  };
  window.addEventListener('storage', handleStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', handleStorage);
  };
};

export const useFundsBlockedSoundEnabled = () =>
  useSyncExternalStore(subscribe, readEnabled, () => false);

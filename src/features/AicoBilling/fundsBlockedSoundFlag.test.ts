/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  advanceFundsBlockedSoundCodeSequence,
  FUNDS_BLOCKED_SOUND_STORAGE_KEY,
  FUNDS_BLOCKED_SOUND_TOGGLE_CODE,
  FUNDS_BLOCKED_SOUND_URL_PARAM,
  INITIAL_FUNDS_BLOCKED_SOUND_CODE_SEQUENCE,
  isFundsBlockedSoundEnabled,
  setFundsBlockedSoundEnabled,
  syncFundsBlockedSoundFlagFromUrl,
  toggleFundsBlockedSoundEnabled,
} from './fundsBlockedSoundFlag';

describe('fundsBlockedSoundFlag', () => {
  beforeEach(() => {
    setFundsBlockedSoundEnabled(false);
    window.history.replaceState(null, '', '/chat');
  });

  afterEach(() => {
    setFundsBlockedSoundEnabled(false);
    vi.restoreAllMocks();
  });

  it('persists enable/disable in localStorage', () => {
    expect(isFundsBlockedSoundEnabled()).toBe(false);

    expect(toggleFundsBlockedSoundEnabled()).toBe(true);
    expect(localStorage.getItem(FUNDS_BLOCKED_SOUND_STORAGE_KEY)).toBe('1');
    expect(isFundsBlockedSoundEnabled()).toBe(true);

    expect(toggleFundsBlockedSoundEnabled()).toBe(false);
    expect(localStorage.getItem(FUNDS_BLOCKED_SOUND_STORAGE_KEY)).toBeNull();
  });

  it('enables from ?poolVade=1 and strips the query param', () => {
    window.history.replaceState(null, '', `/home?${FUNDS_BLOCKED_SOUND_URL_PARAM}=1&x=2`);

    expect(syncFundsBlockedSoundFlagFromUrl()).toBe(true);
    expect(isFundsBlockedSoundEnabled()).toBe(true);
    expect(location.search).toBe('?x=2');
  });

  it('disables from ?poolVade=0 and strips the query param', () => {
    setFundsBlockedSoundEnabled(true);
    window.history.replaceState(null, '', `/home?${FUNDS_BLOCKED_SOUND_URL_PARAM}=0`);

    expect(syncFundsBlockedSoundFlagFromUrl()).toBe(false);
    expect(isFundsBlockedSoundEnabled()).toBe(false);
    expect(location.search).toBe('');
  });

  it('toggles when the secret code is typed', () => {
    let sequence = INITIAL_FUNDS_BLOCKED_SOUND_CODE_SEQUENCE;
    let now = 1000;

    for (const letter of FUNDS_BLOCKED_SOUND_TOGGLE_CODE.slice(0, -1)) {
      const result = advanceFundsBlockedSoundCodeSequence(sequence, letter, now);
      expect(result.completed).toBe(false);
      sequence = result.sequence;
      now += 50;
    }

    const done = advanceFundsBlockedSoundCodeSequence(
      sequence,
      FUNDS_BLOCKED_SOUND_TOGGLE_CODE.at(-1)!,
      now,
    );
    expect(done.completed).toBe(true);
    expect(isFundsBlockedSoundEnabled()).toBe(true);
  });

  it('resets the typed-code buffer after idle timeout', () => {
    const first = advanceFundsBlockedSoundCodeSequence(
      INITIAL_FUNDS_BLOCKED_SOUND_CODE_SEQUENCE,
      'p',
      1000,
    );
    const afterTimeout = advanceFundsBlockedSoundCodeSequence(first.sequence, 'p', 4000);

    expect(afterTimeout.completed).toBe(false);
    expect(afterTimeout.sequence.buffer).toBe('p');
  });
});

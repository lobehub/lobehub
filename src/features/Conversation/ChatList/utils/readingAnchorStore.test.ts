/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearReadingAnchor,
  loadReadingAnchor,
  pruneReadingAnchors,
  READING_ANCHOR_KEY_PREFIX,
  READING_ANCHOR_MAX_AGE_MS,
  READING_ANCHOR_MAX_ENTRIES,
  saveReadingAnchor,
} from './readingAnchorStore';

describe('readingAnchorStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips an anchor per conversation', () => {
    const anchor = { messageId: 'msg_2', offset: 120, savedAt: Date.now() };
    saveReadingAnchor('main_agt_1_tpc_1', anchor);

    expect(loadReadingAnchor('main_agt_1_tpc_1')).toEqual(anchor);
    expect(loadReadingAnchor('main_agt_1_tpc_2')).toBeNull();
  });

  it('keeps an anchor across days but drops it after the max age', () => {
    saveReadingAnchor('k', { messageId: 'msg_1', offset: 0, savedAt: Date.now() });

    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000);
    expect(loadReadingAnchor('k')?.messageId).toBe('msg_1');

    vi.advanceTimersByTime(READING_ANCHOR_MAX_AGE_MS);
    expect(loadReadingAnchor('k')).toBeNull();
    expect(localStorage.getItem(`${READING_ANCHOR_KEY_PREFIX}:k`)).toBeNull();
  });

  it('drops a corrupt entry on read', () => {
    localStorage.setItem(`${READING_ANCHOR_KEY_PREFIX}:k`, '{"messageId":1}');

    expect(loadReadingAnchor('k')).toBeNull();
    expect(localStorage.getItem(`${READING_ANCHOR_KEY_PREFIX}:k`)).toBeNull();
  });

  it('clears an anchor', () => {
    saveReadingAnchor('k', { messageId: 'msg_1', offset: 0, savedAt: Date.now() });
    clearReadingAnchor('k');

    expect(loadReadingAnchor('k')).toBeNull();
  });

  it('prunes the oldest anchors above the cap', () => {
    const now = Date.now();
    for (let i = 0; i < READING_ANCHOR_MAX_ENTRIES + 2; i++) {
      saveReadingAnchor(`k${i}`, { messageId: 'msg', offset: 0, savedAt: now - 1000 + i });
    }

    pruneReadingAnchors();

    expect(loadReadingAnchor('k0')).toBeNull();
    expect(loadReadingAnchor('k1')).toBeNull();
    expect(loadReadingAnchor('k2')).not.toBeNull();
    expect(loadReadingAnchor(`k${READING_ANCHOR_MAX_ENTRIES + 1}`)).not.toBeNull();
  });
});

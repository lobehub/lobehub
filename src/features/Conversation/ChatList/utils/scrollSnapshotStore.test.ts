/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadScrollSnapshot,
  pruneScrollSnapshots,
  saveScrollSnapshot,
  SCROLL_SNAPSHOT_KEY_PREFIX,
  SCROLL_SNAPSHOT_MAX_AGE_MS,
  SCROLL_SNAPSHOT_MAX_ENTRIES,
} from './scrollSnapshotStore';

describe('scrollSnapshotStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('saveScrollSnapshot / loadScrollSnapshot', () => {
    it('persists and reads back the latest snapshot for a context key', () => {
      const savedAt = Date.now();
      saveScrollSnapshot('main_agt_1_tpc_a', { atBottom: false, offset: 1234, savedAt });

      expect(loadScrollSnapshot('main_agt_1_tpc_a')).toEqual({
        atBottom: false,
        offset: 1234,
        savedAt,
      });
    });

    it('namespaces entries by context key so different topics do not collide', () => {
      const savedAt = Date.now();
      saveScrollSnapshot('main_agt_1_tpc_a', { atBottom: false, offset: 100, savedAt });
      saveScrollSnapshot('main_agt_1_tpc_b', { atBottom: true, offset: 0, savedAt });

      expect(loadScrollSnapshot('main_agt_1_tpc_a')?.offset).toBe(100);
      expect(loadScrollSnapshot('main_agt_1_tpc_b')?.atBottom).toBe(true);
    });

    it('returns null when key is missing', () => {
      expect(loadScrollSnapshot('missing')).toBeNull();
    });

    it('returns null and removes corrupt entries on read', () => {
      const storageKey = `${SCROLL_SNAPSHOT_KEY_PREFIX}:bad`;
      localStorage.setItem(storageKey, 'not-json');

      expect(loadScrollSnapshot('bad')).toBeNull();
    });

    it('expires snapshots older than the max age', () => {
      const fixedNow = 1_000_000_000_000;
      vi.useFakeTimers();
      vi.setSystemTime(fixedNow);

      saveScrollSnapshot('stale', {
        atBottom: false,
        offset: 1,
        savedAt: fixedNow - SCROLL_SNAPSHOT_MAX_AGE_MS - 1,
      });

      expect(loadScrollSnapshot('stale')).toBeNull();
      expect(localStorage.getItem(`${SCROLL_SNAPSHOT_KEY_PREFIX}:stale`)).toBeNull();
    });
  });

  describe('pruneScrollSnapshots', () => {
    it('drops expired entries', () => {
      const fixedNow = 1_000_000_000_000;
      vi.useFakeTimers();
      vi.setSystemTime(fixedNow);

      saveScrollSnapshot('fresh', { atBottom: false, offset: 1, savedAt: fixedNow });
      saveScrollSnapshot('expired', {
        atBottom: false,
        offset: 1,
        savedAt: fixedNow - SCROLL_SNAPSHOT_MAX_AGE_MS - 1,
      });

      const result = pruneScrollSnapshots();

      expect(result.evictedExpired).toBe(1);
      expect(localStorage.getItem(`${SCROLL_SNAPSHOT_KEY_PREFIX}:fresh`)).not.toBeNull();
      expect(localStorage.getItem(`${SCROLL_SNAPSHOT_KEY_PREFIX}:expired`)).toBeNull();
    });

    it('removes corrupt entries', () => {
      const corruptKey = `${SCROLL_SNAPSHOT_KEY_PREFIX}:corrupt`;
      localStorage.setItem(corruptKey, '{garbage');

      pruneScrollSnapshots();

      expect(localStorage.getItem(corruptKey)).toBeNull();
    });

    it('evicts oldest entries when over the cap, keeping at most MAX_ENTRIES', () => {
      const fixedNow = Date.now();
      const overflow = 3;
      const total = SCROLL_SNAPSHOT_MAX_ENTRIES + overflow;

      for (let i = 0; i < total; i++) {
        saveScrollSnapshot(`topic_${i}`, {
          atBottom: false,
          offset: i,
          savedAt: fixedNow + i,
        });
      }

      const result = pruneScrollSnapshots();

      expect(result.evictedOverflow).toBe(overflow);
      expect(result.remaining).toBe(SCROLL_SNAPSHOT_MAX_ENTRIES);

      // Oldest entries (lowest savedAt) should be evicted.
      for (let i = 0; i < overflow; i++) {
        expect(localStorage.getItem(`${SCROLL_SNAPSHOT_KEY_PREFIX}:topic_${i}`)).toBeNull();
      }
      // The newest entry must survive.
      expect(
        localStorage.getItem(`${SCROLL_SNAPSHOT_KEY_PREFIX}:topic_${total - 1}`),
      ).not.toBeNull();
    });

    it('ignores unrelated localStorage keys', () => {
      localStorage.setItem('LOBE_PREFERENCE', '{"theme":"dark"}');
      saveScrollSnapshot('topic', { atBottom: false, offset: 0, savedAt: Date.now() });

      pruneScrollSnapshots();

      expect(localStorage.getItem('LOBE_PREFERENCE')).toBe('{"theme":"dark"}');
    });
  });

  describe('saveScrollSnapshot quota recovery', () => {
    it('prunes and retries once when setItem throws QuotaExceededError', () => {
      const fixedNow = 1_000_000_000_000;
      vi.useFakeTimers();
      vi.setSystemTime(fixedNow);

      // Pre-populate one expired entry that pruning can free.
      saveScrollSnapshot('expired', {
        atBottom: false,
        offset: 1,
        savedAt: fixedNow - SCROLL_SNAPSHOT_MAX_AGE_MS - 1,
      });

      // Spy on setItem: throw on first call (the save we're testing), succeed afterwards.
      let callCount = 0;
      const originalSetItem = Storage.prototype.setItem;
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
        this: Storage,
        key,
        value,
      ) {
        callCount += 1;
        if (callCount === 1) {
          const err = new Error('QuotaExceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        originalSetItem.call(this, key, value);
      });

      saveScrollSnapshot('next', { atBottom: false, offset: 9, savedAt: fixedNow });

      // After pruning the expired entry, the retry should have written `next`.
      spy.mockRestore();
      expect(loadScrollSnapshot('next')?.offset).toBe(9);
    });
  });
});

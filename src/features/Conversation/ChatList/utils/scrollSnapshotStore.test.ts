/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isDraftPromotionKey,
  loadScrollSnapshot,
  migrateScrollSnapshot,
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

  describe('isDraftPromotionKey', () => {
    it('matches main scope draft promotion: _new → _<topicId>', () => {
      expect(isDraftPromotionKey('main_agt_xxx_new', 'main_agt_xxx_tpc_yyy')).toBe(true);
    });

    it('matches thread scope draft promotion: ..._new → ..._thd_<id>', () => {
      expect(
        isDraftPromotionKey('thread_agt_xxx_tpc_yyy_new', 'thread_agt_xxx_tpc_yyy_thd_zzz'),
      ).toBe(true);
    });

    it('matches group scope draft promotion', () => {
      expect(isDraftPromotionKey('group_grp_xxx_new', 'group_grp_xxx_tpc_yyy')).toBe(true);
    });

    it('rejects unrelated keys with a coincidentally similar prefix', () => {
      // `xxx_` boundary check: `xxxx` must NOT match `xxx`.
      expect(isDraftPromotionKey('main_agt_xxx_new', 'main_agt_xxxx_tpc_yyy')).toBe(false);
    });

    it('rejects when previous key is not a draft', () => {
      expect(isDraftPromotionKey('main_agt_xxx_tpc_aaa', 'main_agt_xxx_tpc_bbb')).toBe(false);
    });

    it('rejects when keys are identical', () => {
      expect(isDraftPromotionKey('main_agt_xxx_new', 'main_agt_xxx_new')).toBe(false);
    });

    it('rejects switching between two different drafts', () => {
      expect(isDraftPromotionKey('main_agt_xxx_new', 'main_agt_yyy_new')).toBe(false);
    });
  });

  describe('migrateScrollSnapshot', () => {
    it('moves the snapshot from old key to new key and removes the old entry', () => {
      const savedAt = Date.now();
      saveScrollSnapshot('main_agt_xxx_new', { atBottom: false, offset: 4321, savedAt });

      migrateScrollSnapshot('main_agt_xxx_new', 'main_agt_xxx_tpc_yyy');

      expect(loadScrollSnapshot('main_agt_xxx_new')).toBeNull();
      expect(loadScrollSnapshot('main_agt_xxx_tpc_yyy')).toEqual({
        atBottom: false,
        offset: 4321,
        savedAt,
      });
    });

    it('is a no-op when there is no snapshot under the old key', () => {
      migrateScrollSnapshot('main_agt_xxx_new', 'main_agt_xxx_tpc_yyy');

      expect(loadScrollSnapshot('main_agt_xxx_tpc_yyy')).toBeNull();
    });

    it('is a no-op when old and new keys are equal', () => {
      const savedAt = Date.now();
      saveScrollSnapshot('main_agt_xxx_tpc_yyy', { atBottom: false, offset: 1, savedAt });

      migrateScrollSnapshot('main_agt_xxx_tpc_yyy', 'main_agt_xxx_tpc_yyy');

      expect(loadScrollSnapshot('main_agt_xxx_tpc_yyy')?.offset).toBe(1);
    });

    it('drops corrupt source entries instead of migrating them', () => {
      const corruptKey = `${SCROLL_SNAPSHOT_KEY_PREFIX}:main_agt_xxx_new`;
      localStorage.setItem(corruptKey, '{garbage');

      migrateScrollSnapshot('main_agt_xxx_new', 'main_agt_xxx_tpc_yyy');

      expect(localStorage.getItem(corruptKey)).toBeNull();
      expect(loadScrollSnapshot('main_agt_xxx_tpc_yyy')).toBeNull();
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

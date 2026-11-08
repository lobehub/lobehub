import { afterEach, describe, expect, it, vi } from 'vitest';

import { MERGE_METHOD_STORAGE_KEY, readMergeMethod, writeMergeMethod } from '../mergeMethodStorage';

describe('mergeMethodStorage', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('defaults to squash when nothing or garbage is stored', () => {
    expect(readMergeMethod()).toBe('squash');
    window.localStorage.setItem(MERGE_METHOD_STORAGE_KEY, 'yolo');
    expect(readMergeMethod()).toBe('squash');
  });

  it('persists the chosen method', () => {
    writeMergeMethod('rebase');
    expect(window.localStorage.getItem(MERGE_METHOD_STORAGE_KEY)).toBe('rebase');
    expect(readMergeMethod()).toBe('rebase');
  });

  it('survives a throwing localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => writeMergeMethod('merge')).not.toThrow();
    expect(readMergeMethod()).toBe('squash');
  });
});

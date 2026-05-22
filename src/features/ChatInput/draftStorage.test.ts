import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHAT_INPUT_DRAFTS_STORAGE_KEY, getDraft, removeDraft, saveDraft } from './draftStorage';

describe('draftStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves and reads a draft back', () => {
    saveDraft('main_a_new', { root: { children: [] } });
    expect(getDraft('main_a_new')).toEqual({ root: { children: [] } });
  });

  it('returns undefined for a missing key', () => {
    expect(getDraft('missing')).toBeUndefined();
  });

  it('ignores empty keys', () => {
    saveDraft('', { root: {} });
    expect(localStorage.getItem(CHAT_INPUT_DRAFTS_STORAGE_KEY)).toBeNull();
    expect(getDraft('')).toBeUndefined();
  });

  it('removes a draft', () => {
    saveDraft('k', { root: {} });
    removeDraft('k');
    expect(getDraft('k')).toBeUndefined();
  });

  it('overwrites an existing draft for the same key', () => {
    saveDraft('k', { v: 1 });
    saveDraft('k', { v: 2 });
    expect(getDraft('k')).toEqual({ v: 2 });
  });

  it('evicts the oldest drafts beyond the 50 entry cap', () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000));

    for (let i = 0; i < 55; i += 1) {
      saveDraft(`key-${i}`, { i });
    }

    expect(getDraft('key-0')).toBeUndefined();
    expect(getDraft('key-4')).toBeUndefined();
    expect(getDraft('key-5')).toEqual({ i: 5 });
    expect(getDraft('key-54')).toEqual({ i: 54 });
  });

  it('treats corrupt storage as empty and recovers on next write', () => {
    localStorage.setItem(CHAT_INPUT_DRAFTS_STORAGE_KEY, '{not json');
    expect(getDraft('k')).toBeUndefined();

    saveDraft('k', { ok: true });
    expect(getDraft('k')).toEqual({ ok: true });
  });

  it('drops malformed entries when reading', () => {
    localStorage.setItem(
      CHAT_INPUT_DRAFTS_STORAGE_KEY,
      JSON.stringify({ bad: { json: 'nope' }, good: { json: { a: 1 }, updatedAt: 1 } }),
    );
    expect(getDraft('good')).toEqual({ a: 1 });
    expect(getDraft('bad')).toBeUndefined();
  });
});

import { afterEach, describe, expect, it } from 'vitest';

import { createStyleSnapshotApi } from '.';

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('createStyleSnapshotApi', () => {
  it('compares the current page against a snapshot saved before a reload', () => {
    document.body.innerHTML = '<main><p style="color: red">a</p></main><aside>noise</aside>';
    expect(createStyleSnapshotApi().capture('list', 'main')).toBe(1);

    document.body.innerHTML = '<main><p style="color: blue">a</p></main>';
    expect(createStyleSnapshotApi().compare('list')).toEqual([
      { changed: { color: ['red', 'blue'] }, key: '0', label: 'P:a' },
    ]);
  });

  it('clears only its own entries', () => {
    localStorage.setItem('other', '1');
    document.body.innerHTML = '<main></main>';
    const api = createStyleSnapshotApi();
    api.capture('list', 'main');
    api.clear();

    expect(() => api.compare('list')).toThrow('no snapshot named list');
    expect(localStorage.getItem('other')).toBe('1');
  });

  it('names the selector that matched nothing', () => {
    expect(() => createStyleSnapshotApi().capture('x', '#missing')).toThrow('#missing');
  });

  it('refuses to compare across viewport sizes', () => {
    document.body.innerHTML = '<main></main>';
    createStyleSnapshotApi().capture('list', 'main');
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width + 100 });

    try {
      expect(() => createStyleSnapshotApi().compare('list')).toThrow('viewport');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
  });

  it('reads storage only when used, so blocked storage does not break DevDock', () => {
    const api = createStyleSnapshotApi(() => {
      throw new Error('storage blocked');
    });

    expect(() => api.capture('x', 'body')).toThrow('storage blocked');
  });
});

import { describe, expect, it } from 'vitest';

import { createPageViews } from './pageViews';

describe('createPageViews', () => {
  it('gives back the view a page was left with, and nothing for a page never seen', () => {
    const views = createPageViews<{ k: number }>();

    expect(views.swap('p1', 'p2', { k: 0.5 })).toBeUndefined();
    expect(views.swap('p2', 'p1', { k: 0.8 })).toEqual({ k: 0.5 });
    expect(views.swap('p1', 'p2', { k: 0.6 })).toEqual({ k: 0.8 });
  });

  it('keeps nothing for a board that had no page', () => {
    const views = createPageViews<{ k: number }>();

    expect(views.swap(undefined, 'p1', { k: 1 })).toBeUndefined();
    expect(views.swap('p1', undefined, { k: 1 })).toBeUndefined();
  });
});

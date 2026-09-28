import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearCommentHighlights,
  HIGHLIGHT_REGISTRY,
  paintCommentHighlights,
  supportsHighlightApi,
} from './highlights';
import { flattenEditorText } from './textAnchor';

const mount = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
};

class FakeHighlight {
  priority = 0;
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

const withHighlightApi = () => {
  const registry = new Map<string, FakeHighlight>();
  vi.stubGlobal('Highlight', FakeHighlight);
  vi.stubGlobal('CSS', { highlights: registry });
  return registry;
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('comment highlights', () => {
  it('stays a no-op where the Custom Highlight API is missing', () => {
    vi.stubGlobal('CSS', undefined);
    const flat = flattenEditorText(mount('<p>the quick brown fox</p>'));

    expect(supportsHighlightApi()).toBe(false);
    expect(() =>
      paintCommentHighlights({
        activeRootId: null,
        flat,
        matches: new Map([['root-1', { end: 9, start: 4 }]]),
        pending: null,
      }),
    ).not.toThrow();
    expect(() => clearCommentHighlights()).not.toThrow();
  });

  it('paints the resting, active and pending registries', () => {
    const registry = withHighlightApi();
    const flat = flattenEditorText(mount('<p>the quick brown fox</p>'));

    paintCommentHighlights({
      activeRootId: 'root-1',
      flat,
      matches: new Map([
        ['root-1', { end: 9, start: 4 }],
        ['root-2', { end: 15, start: 10 }],
      ]),
      pending: { end: 19, start: 16 },
    });

    expect(registry.get(HIGHLIGHT_REGISTRY.all)?.ranges).toHaveLength(2);
    expect(registry.get(HIGHLIGHT_REGISTRY.active)?.ranges.map(String)).toEqual(['quick']);
    expect(registry.get(HIGHLIGHT_REGISTRY.pending)?.ranges.map(String)).toEqual(['fox']);
  });

  it('gives the active thread the winning priority so it paints over the resting layer', () => {
    const registry = withHighlightApi();
    const flat = flattenEditorText(mount('<p>the quick brown fox</p>'));

    paintCommentHighlights({
      activeRootId: 'root-1',
      flat,
      matches: new Map([['root-1', { end: 9, start: 4 }]]),
      pending: null,
    });

    const all = registry.get(HIGHLIGHT_REGISTRY.all)!;
    const active = registry.get(HIGHLIGHT_REGISTRY.active)!;
    expect(active.priority).toBeGreaterThan(all.priority);
  });

  it('drops a registry rather than leaving a stale paint behind', () => {
    const registry = withHighlightApi();
    const flat = flattenEditorText(mount('<p>the quick brown fox</p>'));
    const matches = new Map([['root-1', { end: 9, start: 4 }]]);

    paintCommentHighlights({ activeRootId: 'root-1', flat, matches, pending: null });
    expect(registry.has(HIGHLIGHT_REGISTRY.active)).toBe(true);

    paintCommentHighlights({ activeRootId: null, flat, matches, pending: null });
    expect(registry.has(HIGHLIGHT_REGISTRY.active)).toBe(false);
  });

  it('skips an anchor that cannot be turned into a range', () => {
    const registry = withHighlightApi();
    const flat = flattenEditorText(mount(''));

    paintCommentHighlights({
      activeRootId: null,
      flat,
      matches: new Map([['root-1', { end: 9, start: 4 }]]),
      pending: null,
    });

    expect(registry.has(HIGHLIGHT_REGISTRY.all)).toBe(false);
  });

  it('clears every registry on teardown', () => {
    const registry = withHighlightApi();
    const flat = flattenEditorText(mount('<p>the quick brown fox</p>'));

    paintCommentHighlights({
      activeRootId: 'root-1',
      flat,
      matches: new Map([['root-1', { end: 9, start: 4 }]]),
      pending: { end: 19, start: 16 },
    });
    clearCommentHighlights();

    expect(registry.size).toBe(0);
  });
});

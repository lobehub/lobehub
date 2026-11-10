import type { DocumentCommentSelectionAnchor } from '@lobechat/types';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ANCHOR_CONTEXT_LENGTH,
  ANCHOR_QUOTE_MAX_LENGTH,
  buildAnchorRange,
  captureSelectionAnchor,
  flattenEditorText,
  locateAnchor,
  pointToOffset,
} from './textAnchor';

const mount = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
};

const anchorOf = (
  quote: string,
  overrides: Partial<DocumentCommentSelectionAnchor> = {},
): DocumentCommentSelectionAnchor => ({
  end: (overrides.start ?? 0) + quote.length,
  quote,
  start: 0,
  ...overrides,
});

/** Select `quote` inside the first text node that contains it. */
const selectText = (root: HTMLElement, quote: string) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const index = node.data.indexOf(quote);
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + quote.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    node = walker.nextNode() as Text | null;
  }
  throw new Error(`No text node contains ${JSON.stringify(quote)}`);
};

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

describe('flattenEditorText', () => {
  it('separates block siblings so adjacent paragraphs never concatenate', () => {
    const root = mount('<p>Hello</p><p>World</p>');

    expect(flattenEditorText(root).text).toBe('Hello\nWorld\n');
  });

  it('keeps inline formatting as one continuous run', () => {
    const root = mount('<p>a <strong>bold</strong> word</p>');

    expect(flattenEditorText(root).text).toBe('a bold word\n');
  });

  it('breaks on <br> and skips non-rendered elements', () => {
    const root = mount('<p>one<br>two<style>.x{}</style></p>');

    expect(flattenEditorText(root).text).toBe('one\ntwo\n');
  });

  it('indexes every text node against the flattened offsets', () => {
    const root = mount('<p>ab</p><p>cd</p>');
    const flat = flattenEditorText(root);

    expect(flat.segments.map(({ end, start }) => [start, end])).toEqual([
      [0, 2],
      [3, 5],
    ]);
    expect(flat.text.slice(3, 5)).toBe('cd');
  });

  it('returns an empty result for a missing root', () => {
    expect(flattenEditorText(null)).toEqual({ segments: [], text: '' });
  });
});

describe('pointToOffset', () => {
  it('maps a text-node boundary to its flattened offset', () => {
    const root = mount('<p>ab</p><p>cd</p>');
    const flat = flattenEditorText(root);
    const second = flat.segments[1].node;

    expect(pointToOffset(flat, second, 1)).toBe(4);
  });

  it('maps an element boundary to the start of the following run', () => {
    const root = mount('<p>ab</p><p>cd</p>');
    const flat = flattenEditorText(root);

    expect(pointToOffset(flat, root, 1)).toBe(3);
  });

  it('maps a past-the-end element boundary to the end of its content', () => {
    const root = mount('<p>ab</p><p>cd</p>');
    const flat = flattenEditorText(root);

    expect(pointToOffset(flat, root, 2)).toBe(5);
  });
});

describe('locateAnchor', () => {
  it('resolves an untouched document at the stored offsets', () => {
    const flat = flattenEditorText(mount('<p>the quick brown fox</p>'));

    expect(locateAnchor(flat, anchorOf('quick', { end: 9, start: 4 }))).toEqual({
      end: 9,
      start: 4,
    });
  });

  it('follows the quote when text above it was inserted', () => {
    const flat = flattenEditorText(mount('<p>new line</p><p>the quick brown fox</p>'));

    expect(locateAnchor(flat, anchorOf('quick', { end: 9, start: 4 }))).toEqual({
      end: 18,
      start: 13,
    });
  });

  it('uses the surrounding context to pick between repeated quotes', () => {
    const flat = flattenEditorText(mount('<p>alpha target omega</p><p>delta target sigma</p>'));

    expect(
      locateAnchor(flat, {
        end: 6,
        prefix: 'delta ',
        quote: 'target',
        start: 0,
        suffix: ' sigma',
      }),
    ).toEqual({ end: 31, start: 25 });
  });

  it('falls back to the nearest occurrence when no context was stored', () => {
    const flat = flattenEditorText(mount('<p>target</p><p>target</p>'));

    expect(locateAnchor(flat, anchorOf('target', { end: 13, start: 7 }))).toEqual({
      end: 13,
      start: 7,
    });
  });

  it('ignores the stored offsets when a different sentence took that position', () => {
    // The reader inserted a paragraph that happens to repeat the quoted phrase
    // at exactly the old offset; the original still exists further down.
    const flat = flattenEditorText(mount('<p>delta target sigma</p><p>alpha target omega</p>'));

    expect(
      locateAnchor(flat, {
        end: 12,
        prefix: 'alpha ',
        quote: 'target',
        start: 6,
        suffix: ' omega',
      }),
    ).toEqual({ end: 31, start: 25 });
  });

  it('reports the anchor lost when the quote repeats past the scan cap without matching context', () => {
    const flat = flattenEditorText(mount(`<p>${'x '.repeat(4000)}</p>`));

    expect(
      locateAnchor(flat, { end: 5, prefix: 'gone ', quote: 'x', start: 4, suffix: ' away' }),
    ).toBeNull();
  });

  it('keeps the nearest repetition when the quote repeats far past the scan cap', () => {
    // Every occurrence carries identical context, so only distance can settle
    // it — and a top-down scan would burn the whole budget before reaching it.
    const flat = flattenEditorText(mount(`<p>a${'x '.repeat(4000)}</p>`));
    const quoteStart = 6000;

    const match = locateAnchor(flat, {
      end: quoteStart + 1,
      prefix: flat.text.slice(quoteStart - ANCHOR_CONTEXT_LENGTH - 1, quoteStart - 1),
      quote: 'x',
      start: quoteStart,
      suffix: flat.text.slice(quoteStart, quoteStart + ANCHOR_CONTEXT_LENGTH),
    })!;

    expect(Math.abs(match.start - quoteStart)).toBeLessThanOrEqual(1);
  });

  it('returns null once the quoted run is gone', () => {
    const flat = flattenEditorText(mount('<p>nothing like it here</p>'));

    expect(locateAnchor(flat, anchorOf('quick', { end: 9, start: 4 }))).toBeNull();
  });

  it('returns null for an empty body', () => {
    expect(locateAnchor(flattenEditorText(mount('')), anchorOf('quick'))).toBeNull();
  });
});

describe('buildAnchorRange', () => {
  it('spans the located run', () => {
    const root = mount('<p>the quick brown fox</p>');
    const flat = flattenEditorText(root);

    const range = buildAnchorRange(flat, { end: 9, start: 4 });

    expect(range?.toString()).toBe('quick');
  });

  it('spans a run that crosses a block boundary', () => {
    const root = mount('<p>ab</p><p>cd</p>');
    const flat = flattenEditorText(root);

    const range = buildAnchorRange(flat, { end: 5, start: 1 });

    expect(range?.toString()).toBe('bcd');
  });

  it('returns null when the body has no text', () => {
    expect(buildAnchorRange(flattenEditorText(mount('')), { end: 1, start: 0 })).toBeNull();
  });
});

describe('captureSelectionAnchor', () => {
  it('captures the quote with its surrounding context', () => {
    const root = mount('<p>the quick brown fox</p>');
    selectText(root, 'quick');

    expect(captureSelectionAnchor(root)).toEqual({
      end: 9,
      prefix: 'the ',
      quote: 'quick',
      start: 4,
      suffix: ' brown fox\n',
    });
  });

  it('trims whitespace at the selection edges', () => {
    const root = mount('<p>the quick brown fox</p>');
    selectText(root, ' quick ');

    const anchor = captureSelectionAnchor(root)!;

    expect(anchor.quote).toBe('quick');
    expect(anchor.end).toBe(anchor.start + anchor.quote.length);
  });

  it('caps an oversized selection at the stored quote limit', () => {
    const root = mount(`<p>${'x'.repeat(ANCHOR_QUOTE_MAX_LENGTH + 50)}</p>`);
    selectText(root, 'x'.repeat(ANCHOR_QUOTE_MAX_LENGTH + 50));

    const anchor = captureSelectionAnchor(root)!;

    expect(anchor.quote).toHaveLength(ANCHOR_QUOTE_MAX_LENGTH);
    expect(anchor.end).toBe(anchor.start + ANCHOR_QUOTE_MAX_LENGTH);
  });

  it('never cuts a surrogate pair in half when windowing the context', () => {
    // A lone surrogate is not well-formed text; Postgres rejects it on insert,
    // so an emoji sitting on a window boundary must not be split.
    const root = mount(
      `<p>\u{1F600}${'a'.repeat(ANCHOR_CONTEXT_LENGTH - 1)}word\u{1F600}${'b'.repeat(ANCHOR_CONTEXT_LENGTH)}</p>`,
    );
    selectText(root, 'word');

    const anchor = captureSelectionAnchor(root)!;

    expect(anchor.prefix!.isWellFormed()).toBe(true);
    expect(anchor.suffix!.isWellFormed()).toBe(true);
    expect(anchor.quote.isWellFormed()).toBe(true);
  });

  it('keeps an oversized selection well-formed when the cap lands inside a surrogate pair', () => {
    const root = mount(`<p>${'x'.repeat(ANCHOR_QUOTE_MAX_LENGTH - 1)}\u{1F600}yyy</p>`);
    selectText(root, `${'x'.repeat(ANCHOR_QUOTE_MAX_LENGTH - 1)}\u{1F600}yyy`);

    const anchor = captureSelectionAnchor(root)!;

    expect(anchor.quote).toHaveLength(ANCHOR_QUOTE_MAX_LENGTH - 1);
    expect(anchor.quote.isWellFormed()).toBe(true);
    expect(anchor.end).toBe(anchor.start + anchor.quote.length);
  });

  it('returns null for a collapsed selection', () => {
    const root = mount('<p>the quick brown fox</p>');
    const flat = flattenEditorText(root);
    const range = document.createRange();
    range.setStart(flat.segments[0].node, 2);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(captureSelectionAnchor(root)).toBeNull();
  });

  it('returns null for a whitespace-only selection', () => {
    const root = mount('<p>a   b</p>');
    selectText(root, '   ');

    expect(captureSelectionAnchor(root)).toBeNull();
  });

  it('returns null for a selection outside the body', () => {
    const root = mount('<p>inside</p>');
    const outside = mount('<p>outside</p>');
    selectText(outside, 'outside');

    expect(captureSelectionAnchor(root)).toBeNull();
  });

  it('round-trips a captured anchor back to the same range', () => {
    const root = mount('<p>alpha</p><p>the quick brown fox</p>');
    selectText(root, 'brown');

    const anchor = captureSelectionAnchor(root)!;
    const flat = flattenEditorText(root);
    const match = locateAnchor(flat, anchor)!;

    expect(buildAnchorRange(flat, match)?.toString()).toBe('brown');
  });
});

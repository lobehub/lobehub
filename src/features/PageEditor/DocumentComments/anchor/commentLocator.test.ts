import { afterEach, describe, expect, it, vi } from 'vitest';

import { focusCommentCard } from './commentLocator';

const mountCard = (id: string, options: { inGutter?: boolean } = {}) => {
  const host = options.inGutter
    ? (() => {
        const gutter = document.createElement('div');
        gutter.setAttribute('data-document-comment-gutter', '');
        document.body.append(gutter);
        return gutter;
      })()
    : document.body;
  const card = document.createElement('div');
  card.setAttribute('data-document-comment-id', id);
  card.scrollIntoView = vi.fn();
  host.append(card);
  return card;
};

describe('focusCommentCard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns false when the card is not mounted (unloaded page)', () => {
    expect(focusCommentCard('missing')).toBe(false);
  });

  it('does not scroll a gutter card when the caller opts out of scrolling — the panel already shows it', () => {
    const card = mountCard('a', { inGutter: true });

    focusCommentCard('a', { scroll: false });

    expect(card.scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls a flat-list card into view even when the caller asked to skip scrolling, since without a gutter it can be off-screen', () => {
    const card = mountCard('a', { inGutter: false });

    const result = focusCommentCard('a', { scroll: false });

    expect(result).toBe(true);
    expect(card.scrollIntoView).toHaveBeenCalled();
  });

  it('still flashes a flat-list card, unlike a gutter one', () => {
    const gutterCard = mountCard('gutter-card', { inGutter: true });
    const flatCard = mountCard('flat-card', { inGutter: false });

    focusCommentCard('gutter-card', { scroll: false });
    focusCommentCard('flat-card', { scroll: false });

    expect(gutterCard.className).toBe('');
    expect(flatCard.className).not.toBe('');
  });

  it('prefers the gutter copy when the same thread renders in both the flat list and the gutter', () => {
    // The flat list is the document's complete record and always includes
    // anchored threads too, so an open gutter renders the same thread twice —
    // the list copy first in DOM order.
    const flatCopy = mountCard('a', { inGutter: false });
    const gutterCopy = mountCard('a', { inGutter: true });

    const result = focusCommentCard('a', { scroll: false });

    expect(result).toBe(true);
    // Must not throw the viewport down to the flat-list copy when the
    // gutter's own copy is already visible beside the clicked run.
    expect(flatCopy.scrollIntoView).not.toHaveBeenCalled();
    expect(gutterCopy.scrollIntoView).not.toHaveBeenCalled();
    expect(flatCopy.className).toBe('');
  });

  it('does not scroll away when a gutter exists but has not mounted its card yet (a closed panel about to open)', () => {
    // Only the flat-list copy exists at this instant — the gutter is mounting
    // in the same tick as a separate effect that opens the panel, so the DOM
    // alone can't yet say a gutter is coming.
    const flatCopy = mountCard('a', { inGutter: false });

    const result = focusCommentCard('a', { hasGutter: true, scroll: false });

    expect(result).toBe(true);
    expect(flatCopy.scrollIntoView).not.toHaveBeenCalled();
  });
});

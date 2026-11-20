import { describe, expect, it, vi } from 'vitest';

import {
  findFoldedMatches,
  findKeywordRanges,
  requestReveal,
  REVEAL_IN_PAGE_EVENT,
  scrollRangeIntoView,
} from './findInDom';

const render = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
};

describe('findKeywordRanges', () => {
  it('skips editable text unless asked to include it', () => {
    const root = render(
      '<textarea>deploy</textarea><div contenteditable="true"><p>Deploy here</p></div><span>deploy</span>',
    );

    expect(findKeywordRanges(root, 'deploy')).toHaveLength(1);
    expect(
      findKeywordRanges(root, 'deploy', { includeEditable: true }).map((range) => range.toString()),
    ).toEqual(['Deploy', 'deploy']);
  });

  it('keeps form fields out even when editable text is included', () => {
    const root = render('<input value="deploy" /><textarea>deploy</textarea>');

    expect(findKeywordRanges(root, 'deploy', { includeEditable: true })).toEqual([]);
  });

  it('matches CJK text and repeated occurrences in one node', () => {
    const root = render('<p>资源库 Drive 页的资源库</p>');

    expect(findKeywordRanges(root, '资源库')).toHaveLength(2);
  });
});

describe('scrollRangeIntoView', () => {
  const box = (top: number, height: number) =>
    ({ bottom: top + height, height, top, width: 100 }) as DOMRect;

  const setup = (rangeTop: number) => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'scrollTop', { value: 200, writable: true });
    container.getBoundingClientRect = () => box(0, 600);
    container.scrollTo = vi.fn() as typeof container.scrollTo;
    const range = { getBoundingClientRect: () => box(rangeTop, 20) } as unknown as Range;
    return { container, range };
  };

  it('leaves a match that is already well on screen alone', () => {
    const { container, range } = setup(300);
    scrollRangeIntoView(range, container);
    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  it('centers a match below the fold', () => {
    const { container, range } = setup(1000);
    scrollRangeIntoView(range, container);
    // 200 + 1000 - 0 - 300 + 10
    expect(container.scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: 910 });
  });
});

describe('requestReveal', () => {
  it('bubbles the match box up to whatever clamps it', () => {
    const root = render('<div class="clamp"><p>deploy</p></div>');
    const listener = vi.fn();
    root.querySelector('.clamp')!.addEventListener(REVEAL_IN_PAGE_EVENT, listener);
    const [range] = findKeywordRanges(root, 'deploy');
    range.getBoundingClientRect = () => ({ bottom: 420, top: 400 }) as DOMRect;

    requestReveal(range);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].detail).toEqual({ bottom: 420, top: 400 });
  });
});

describe('findFoldedMatches', () => {
  it('keeps matching a node whose lower-casing changes length', () => {
    // `İ`.toLowerCase() is two code units, which used to drop the whole node.
    const text = 'İstanbul deployment failed';
    const [[start, end]] = findFoldedMatches(text, 'deployment');

    expect(text.slice(start, end)).toBe('deployment');
  });

  it('maps a match on the expanded character back to original offsets', () => {
    const text = 'Gİt İstanbul';
    expect(findFoldedMatches(text, 'i̇stanbul').map(([s, e]) => text.slice(s, e))).toEqual([
      'İstanbul',
    ]);
  });

  it('drops a match that would split one folded character', () => {
    // 'i' alone is only half of the folded `İ` (i + combining dot).
    expect(findFoldedMatches('İ', 'i')).toEqual([]);
  });

  it('matches astral characters by code point', () => {
    const text = 'ship 🚀 now 🚀';
    expect(findFoldedMatches(text, '🚀')).toHaveLength(2);
  });
});

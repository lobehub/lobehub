import { describe, expect, it } from 'vitest';

import { collectHeadings, findActiveIndex, findBodyRoot, isSameOutline } from './headings';

const render = (html: string) => {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
};

describe('findBodyRoot', () => {
  it('returns the first Lexical root so comment editors are ignored', () => {
    const content = render(
      '<textarea></textarea><div data-lexical-editor id="body"></div><div data-lexical-editor id="comment"></div>',
    );

    expect(findBodyRoot(content)?.id).toBe('body');
  });

  it('returns null without an editor', () => {
    expect(findBodyRoot(render('<p></p>'))).toBeNull();
    expect(findBodyRoot(null)).toBeNull();
  });
});

describe('collectHeadings', () => {
  it('collects h1-h3 in document order and skips empty headings', () => {
    const root = render(
      '<h1>Intro</h1><p>text</p><h2> Setup </h2><h4>Deep</h4><h3></h3><h3>Details</h3>',
    );

    expect(collectHeadings(root).map(({ level, text }) => ({ level, text }))).toEqual([
      { level: 1, text: 'Intro' },
      { level: 2, text: 'Setup' },
      { level: 3, text: 'Details' },
    ]);
  });

  it('returns an empty list without a root', () => {
    expect(collectHeadings(null)).toEqual([]);
  });
});

describe('findActiveIndex', () => {
  it('picks the last heading above the threshold', () => {
    expect(findActiveIndex([-300, -20, 40, 600], 80)).toBe(2);
  });

  it('falls back to the first heading before any is reached', () => {
    expect(findActiveIndex([200, 600], 80)).toBe(0);
  });

  it('picks the last heading once the pane reaches the bottom', () => {
    expect(findActiveIndex([-300, 40, 600], 80, true)).toBe(2);
  });

  it('returns -1 without headings', () => {
    expect(findActiveIndex([], 80)).toBe(-1);
    expect(findActiveIndex([], 80, true)).toBe(-1);
  });
});

describe('isSameOutline', () => {
  it('treats an unchanged outline as the same and edits to headings as different', () => {
    const root = render('<h1>A</h1><p>text</p><h2>B</h2>');
    const before = collectHeadings(root);

    root.querySelector('p')!.textContent = 'edited';
    expect(isSameOutline(before, collectHeadings(root))).toBe(true);

    root.querySelector('h2')!.textContent = 'B2';
    expect(isSameOutline(before, collectHeadings(root))).toBe(false);
  });
});

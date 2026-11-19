import { afterEach, describe, expect, it } from 'vitest';

import { readPDFTextSelection } from './textSelection';

const renderPages = (pages: string[]) => {
  const root = document.createElement('div');
  root.innerHTML = pages
    .map(
      (text, index) => `
        <div class="react-pdf__Page" data-page-number="${index + 1}">
          <canvas></canvas>
          <div class="react-pdf__Page__textContent textLayer"><span>${text}</span></div>
        </div>
        <div class="gap"></div>`,
    )
    .join('');
  document.body.append(root);

  const spans = [...root.querySelectorAll('span')].map((span) => span.firstChild as Text);
  return { root, spans };
};

const select = (start: Node, startOffset: number, end: Node, endOffset: number) => {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);

  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
};

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

describe('readPDFTextSelection', () => {
  it('reads selected text with its page number', () => {
    const { root, spans } = renderPages(['Theorem 1. Bounded sequences converge.', 'Proof.']);

    const selection = select(spans[0], 0, spans[0], 10);

    expect(readPDFTextSelection(selection, root)).toEqual({
      content: 'Theorem 1.',
      pageRange: { startPage: 1 },
    });
  });

  it('reports a page range when the selection crosses pages', () => {
    const { root, spans } = renderPages(['first page', 'second page', 'third page']);

    const selection = select(spans[1], 7, spans[2], 5);

    expect(readPDFTextSelection(selection, root)?.pageRange).toEqual({
      endPage: 3,
      startPage: 2,
    });
  });

  it('keeps the last page when the drag ends in the gap below it', () => {
    const { root, spans } = renderPages(['first page', 'second page']);
    const gap = root.querySelectorAll('.gap')[1];

    const selection = select(spans[0], 6, gap, 0);

    expect(readPDFTextSelection(selection, root)?.pageRange).toEqual({
      endPage: 2,
      startPage: 1,
    });
  });

  it('ignores collapsed or whitespace-only selections', () => {
    const { root, spans } = renderPages(['a   b']);

    expect(readPDFTextSelection(select(spans[0], 2, spans[0], 2), root)).toBeUndefined();
    expect(readPDFTextSelection(select(spans[0], 1, spans[0], 4), root)).toBeUndefined();
  });

  it('ignores a selection that reaches outside the viewer', () => {
    const { root, spans } = renderPages(['inside']);
    const outside = document.createElement('p');
    outside.textContent = 'outside';
    document.body.append(outside);

    const selection = select(spans[0], 0, outside.firstChild!, 3);

    expect(readPDFTextSelection(selection, root)).toBeUndefined();
  });
});

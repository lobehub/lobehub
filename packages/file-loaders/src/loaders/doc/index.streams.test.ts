import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileLoaderInterface } from '../../types';
import { DocLoader } from './index';

const { extractMock } = vi.hoisted(() => ({ extractMock: vi.fn() }));

vi.mock('word-extractor', () => ({
  default: class {
    extract = extractMock;
  },
}));

/**
 * A .doc keeps text boxes, footnotes and endnotes in streams of their own, and
 * Word puts all of them on the page. Reading only the body drops every callout,
 * pull quote and footnote, with nothing to say it happened.
 */
const wordDocument = (streams: {
  body?: string;
  endnotes?: string;
  footnotes?: string;
  textboxes?: string;
}) => ({
  getBody: () => streams.body ?? '',
  getEndnotes: () => streams.endnotes ?? '',
  getFootnotes: () => streams.footnotes ?? '',
  getTextboxes: () => streams.textboxes ?? '',
});

let loader: FileLoaderInterface;

beforeEach(() => {
  extractMock.mockReset();
  loader = new DocLoader();
});

describe('DocLoader streams', () => {
  it('keeps the text boxes a .doc stores outside the body', async () => {
    extractMock.mockResolvedValueOnce(
      wordDocument({ body: 'Paragraph 1\n\nParagraph 2', textboxes: 'First text box, regular' }),
    );

    const pages = await loader.loadPages('irrelevant.doc');

    expect(pages[0].pageContent).toBe('Paragraph 1\n\nParagraph 2\n\nFirst text box, regular');
  });

  it('keeps the footnotes and endnotes', async () => {
    extractMock.mockResolvedValueOnce(
      wordDocument({
        body: 'Endnotes and footnotes test',
        endnotes: ' This is an endnote\n',
        footnotes: ' This is a footnote\n',
      }),
    );

    const pages = await loader.loadPages('irrelevant.doc');

    expect(pages[0].pageContent).toBe(
      'Endnotes and footnotes test\n\nThis is a footnote\n\nThis is an endnote',
    );
  });

  it('does not open a body-less document with two blank lines', async () => {
    extractMock.mockResolvedValueOnce(wordDocument({ textboxes: 'Only a text box' }));

    const pages = await loader.loadPages('irrelevant.doc');

    expect(pages[0].pageContent).toBe('Only a text box');
    expect(pages[0].lineCount).toBe(1);
  });

  it('leaves a document that only has a body exactly as it was', async () => {
    extractMock.mockResolvedValueOnce(wordDocument({ body: 'Only a body here\n' }));

    const pages = await loader.loadPages('irrelevant.doc');

    expect(pages[0].pageContent).toBe('Only a body here\n');
    expect(pages[0].charCount).toBe('Only a body here\n'.length);
  });
});

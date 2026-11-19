import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { getFileSelectionLocation } from './fileSelectionLocation';

const t = ((key: string, options?: Record<string, number>) =>
  key === 'contextSelection.file.page'
    ? `p. ${options?.page}`
    : `pp. ${options?.start}–${options?.end}`) as unknown as TFunction<'chat'>;

describe('getFileSelectionLocation', () => {
  it('names the file and its single page', () => {
    expect(getFileSelectionLocation({ pageRange: { startPage: 3 }, title: 'paper.pdf' }, t)).toBe(
      'paper.pdf · p. 3',
    );
  });

  it('collapses a range that starts and ends on one page', () => {
    expect(getFileSelectionLocation({ pageRange: { endPage: 3, startPage: 3 } }, t)).toBe('p. 3');
  });

  it('shows a page range for a selection across pages', () => {
    expect(
      getFileSelectionLocation({ pageRange: { endPage: 5, startPage: 4 }, title: 'paper.pdf' }, t),
    ).toBe('paper.pdf · pp. 4–5');
  });

  it('falls back to the file name without pages', () => {
    expect(getFileSelectionLocation({ title: 'paper.pdf' }, t)).toBe('paper.pdf');
  });
});
